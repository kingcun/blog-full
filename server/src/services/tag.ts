import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DB } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { postHashtags, hashtags } from "../db/schema";
import type { AppContext } from "../core/hono-types";

export function TagService(): Hono {
    const app = new Hono();

    // GET /tag
    app.get('/', async (c: AppContext) => {
        const db = c.get('db');
        
        const tag_list = await profileAsync(c, 'tag_list_db', () => db.query.hashtags.findMany({
            with: {
                posts: { columns: { postId: true } }
            }
        }));
        
        const result = tag_list.map((tag: any) => ({
            ...tag,
            posts: tag.posts.length
        }));
        
        return c.json(result);
    });

    // GET /tag/:name
    app.get('/:name', async (c: AppContext) => {
        const db = c.get('db');
        const admin = c.get('admin');
        const nameDecoded = decodeURI(c.req.param('name'));
        
        const tag = await profileAsync(c, 'tag_detail_db', () => db.query.hashtags.findFirst({
            where: eq(hashtags.name, nameDecoded),
            with: {
                posts: {
                    with: {
                        post: {
                            columns: {
                                id: true, title: true, summary: true, content: true, 
                                createdAt: true, updatedAt: true, draft: false, listed: false
                            },
                            with: {
                                user: { columns: { id: true, username: true, avatar: true } },
                                hashtags: {
                                    columns: {},
                                    with: { hashtag: { columns: { id: true, name: true } } }
                                }
                            },
                            where: (posts: any) => admin ? undefined : and(eq(posts.draft, 0), eq(posts.listed, 1))
                        } as any
                    }
                }
            }
        }));
        
        const tagPosts = tag?.posts.map((tagPost: any) => {
            if (!tagPost.post) return null;
            return {
                ...tagPost.post,
                hashtags: tagPost.post.hashtags.map((hashtag: any) => hashtag.hashtag)
            };
        }).filter((post: any) => post !== null);
        
        if (!tag) {
            return c.text('Not found', 404);
        }
        
        return c.json({ ...tag, posts: tagPosts });
    });

    return app;
}

export async function bindTagToPost(db: DB, postId: number, tags: string[]) {
    await db.delete(postHashtags).where(eq(postHashtags.postId, postId));
    
    for (const tag of tags) {
        const tagId = await getTagIdOrCreate(db, tag);
        await db.insert(postHashtags).values({
            postId: postId,
            hashtagId: tagId
        });
    }
}

async function getTagByName(db: DB, name: string) {
    return await db.query.hashtags.findFirst({ where: eq(hashtags.name, name) });
}

async function getTagIdOrCreate(db: DB, name: string) {
    const tag = await getTagByName(db, name);
    if (tag) {
        return tag.id;
    } else {
        const result = await db.insert(hashtags).values({ name }).returning({ insertedId: hashtags.id });
        if (result.length === 0) {
            throw new Error('Failed to insert');
        } else {
            return result[0].insertedId;
        }
    }
}
