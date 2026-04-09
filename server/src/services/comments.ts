import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { desc, eq } from "drizzle-orm";
import { comments, posts, users } from "../db/schema";
import { profileAsync } from "../core/server-timing";
import { notify } from "../utils/webhook";
import { resolveWebhookConfig } from "./config-helpers";

export function CommentService(): Hono {
    const app = new Hono();

    app.get('/:post', async (c: AppContext) => {
        const db = c.get('db');
        const postId = parseInt(c.req.param('post'));
        
        const comment_list = await profileAsync(c, 'comment_list_db', () => db.query.comments.findMany({
            where: eq(comments.postId, postId),
            columns: { postId: false, userId: false },
            with: {
                user: {
                    columns: { id: true, username: true, avatar: true, permission: true }
                }
            },
            orderBy: [desc(comments.createdAt)]
        }));
        
        return c.json(comment_list);
    });

    app.post('/:post', async (c: AppContext) => {
        const db = c.get('db');
        const env = c.get('env');
        const serverConfig = c.get('serverConfig');
        const uid = c.get('uid');
        const postId = parseInt(c.req.param('post'));
        const body = await profileAsync(c, 'comment_create_parse', () => c.req.json());
        const { content } = body;
        
        if (!uid) {
            return c.text('Unauthorized', 401);
        }
        if (!content) {
            return c.text('Content is required', 400);
        }
        
        if (uid == undefined) {
            return c.text('Invalid uid', 400);
        }
        
        const user = await profileAsync(c, 'comment_create_user', () => db.query.users.findFirst({ where: eq(users.id, uid) }));
        if (!user) {
            return c.text('User not found', 400);
        }
        
        const exist = await profileAsync(c, 'comment_create_post', () => db.query.posts.findFirst({ where: eq(posts.id, postId) }));
        if (!exist) {
            return c.text('Post not found', 400);
        }

        await profileAsync(c, 'comment_create_insert', () => db.insert(comments).values({
            postId,
            userId: uid,
            content
        }));

        const {
            webhookUrl,
            webhookMethod,
            webhookContentType,
            webhookHeaders,
            webhookBodyTemplate,
        } = await profileAsync(c, 'comment_create_webhook_config', () => resolveWebhookConfig(serverConfig, env));
        const frontendUrl = new URL(c.req.url).origin;
        try {
            await profileAsync(c, 'comment_create_notify', () => notify(
                webhookUrl || "",
                {
                    event: "comment.created",
                    message: `${frontendUrl}/post/${postId}\n${user.username} 评论了: ${exist.title}\n${content}`,
                    title: exist.title || "",
                    url: `${frontendUrl}/post/${postId}`,
                    username: user.username,
                    content,
                },
                {
                    method: webhookMethod,
                    contentType: webhookContentType,
                    headers: webhookHeaders,
                    bodyTemplate: webhookBodyTemplate,
                },
            ));
        } catch (error) {
            console.error("Failed to send comment webhook", error);
        }
        return c.text('OK');
    });

    app.delete('/:id', async (c: AppContext) => {
        const db = c.get('db');
        const uid = c.get('uid');
        const admin = c.get('admin');
        
        if (uid === undefined) {
            return c.text('Unauthorized', 401);
        }
        
        const id_num = parseInt(c.req.param('id'));
        const comment = await profileAsync(c, 'comment_delete_lookup', () => db.query.comments.findFirst({ where: eq(comments.id, id_num) }));
        
        if (!comment) {
            return c.text('Not found', 404);
        }
        
        if (!admin && comment.userId !== uid) {
            return c.text('Permission denied', 403);
        }
        
        await profileAsync(c, 'comment_delete_db', () => db.delete(comments).where(eq(comments.id, id_num)));
        return c.text('OK');
    });

    return app;
}
