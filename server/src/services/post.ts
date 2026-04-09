import { and, asc, count, desc, eq, gt, like, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import type { Variables } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { posts, visits, visitStats } from "../db/schema";
import { HyperLogLog } from "../utils/hyperloglog";
import { extractImageWithMetadata } from "../utils/image";
import { extractAndEnsureThumbnail } from "../utils/thumbnail";
import { syncPostAISummaryQueueState } from "./post-ai-summary";
import { bindTagToPost } from "./tag";
import { clearPostCache } from "./clear-post-cache";
export { clearPostCache } from "./clear-post-cache";

// Lazy-loaded modules for WordPress import
let XMLParser: any;
let html2md: any;

async function initWPModules() {
    if (!XMLParser) {
        const fxp = await import("fast-xml-parser");
        XMLParser = fxp.XMLParser;
    }
    if (!html2md) {
        const h2m = await import("html-to-md");
        html2md = h2m.default;
    }
}

export function PostService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // GET /post - List posts
    app.get('/', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const page = c.req.query('page');
        const limit = c.req.query('limit');
        const type = c.req.query('type');

        if ((type === 'draft' || type === 'unlisted') && !admin) {
            return c.text('Permission denied', 403);
        }

        const page_num = (page ? parseInt(page) > 0 ? parseInt(page) : 1 : 1) - 1;
        const limit_num = limit ? parseInt(limit) > 50 ? 50 : parseInt(limit) : 20;
        const cacheKey = `posts_${type}_${page_num}_${limit_num}`;
        const cached = await profileAsync(c, 'post_list_cache_get', () => cache.get(cacheKey));

        if (cached) {
            return c.json(cached);
        }

        const where = type === 'draft'
            ? eq(posts.draft, 1)
            : type === 'unlisted'
                ? and(eq(posts.draft, 0), eq(posts.listed, 0))
                : and(eq(posts.draft, 0), eq(posts.listed, 1));

        const size = await profileAsync(c, 'post_list_count', () => db.select({ count: count() }).from(posts).where(where));

        if (size[0].count === 0) {
            return c.json({ size: 0, data: [], hasNext: false });
        }

        const env = c.get('env');
        const requestOrigin = new URL(c.req.url).origin;

        const rawPostList = await profileAsync(c, 'post_list_db', () => db.query.posts.findMany({
            where: where,
            columns: admin ? undefined : { draft: false, listed: false },
            with: {
                hashtags: {
                    columns: {},
                    with: {
                        hashtag: { columns: { id: true, name: true } }
                    }
                },
                user: { columns: { id: true, username: true, avatar: true } }
            },
            orderBy: [desc(posts.top), desc(posts.createdAt), desc(posts.updatedAt)],
            offset: page_num * limit_num,
            limit: limit_num + 1,
        }));

        // Upload external thumbnails to R2/S3 in parallel, then map to response shape
        const post_list = await Promise.all(rawPostList.map(async ({ content, hashtags, summary, ...other }: any) => {
            // Extract first image from content and ensure it is uploaded to R2 if external
            const avatar = await extractAndEnsureThumbnail(content, env, requestOrigin);
            return {
                summary: summary.length > 0 ? summary : content.length > 100 ? content.slice(0, 100) : content,
                hashtags: hashtags.map(({ hashtag }: any) => hashtag),
                avatar,
                ...other
            };
        }));

        let hasNext = false;
        if (post_list.length === limit_num + 1) {
            post_list.pop();
            hasNext = true;
        }

        const data = { size: size[0].count, data: post_list, hasNext };

        if (type === undefined || type === 'normal' || type === '') {
            await profileAsync(c, 'post_list_cache_set', () => cache.set(cacheKey, data));
        }

        return c.json(data);
    });

    // GET /post/timeline
    app.get('/timeline', async (c) => {
        const db = c.get('db');
        const where = and(eq(posts.draft, 0), eq(posts.listed, 1));

        return c.json(await profileAsync(c, 'post_timeline_db', () => db.query.posts.findMany({
            where: where,
            columns: { id: true, title: true, createdAt: true },
            orderBy: [desc(posts.createdAt), desc(posts.updatedAt)],
        })));
    });

    // POST /post - Create post
    app.post('/', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const serverConfig = c.get('serverConfig');
        const env = c.get('env');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const body = await profileAsync(c, 'post_create_parse', () => c.req.json());
        const { title, alias, listed, content, summary, draft, tags, createdAt } = body;

        if (!admin) {
            return c.text('Permission denied', 403);
        }

        if (!title) {
            return c.text('Title is required', 400);
        }
        if (!content) {
            return c.text('Content is required', 400);
        }

        const exist = await profileAsync(c, 'post_create_existing', () => db.query.posts.findFirst({
            where: or(eq(posts.title, title), eq(posts.content, content))
        }));

        if (exist) {
            return c.text('Content already exists', 400);
        }

        const date = createdAt ? new Date(createdAt) : new Date();

        if (!uid) {
            return c.text('User ID is required', 400);
        }

        const result = await profileAsync(c, 'post_create_insert', () => db.insert(posts).values({
            title,
            content,
            summary,
            ai_summary: "",
            ai_summary_status: "idle",
            ai_summary_error: "",
            uid,
            alias,
            listed: listed ? 1 : 0,
            draft: draft ? 1 : 0,
            createdAt: date,
            updatedAt: date
        }).returning({ insertedId: posts.id }));

        await profileAsync(c, 'post_create_tags', () => bindTagToPost(db, result[0].insertedId, tags));
        await profileAsync(c, 'post_create_ai_queue', () => syncPostAISummaryQueueState(db, serverConfig, env, result[0].insertedId, {
            draft: Boolean(draft),
            updatedAt: date,
            resetSummary: true,
        }));
        await profileAsync(c, 'post_create_cache_invalidate', () => cache.deletePrefix('posts_'));

        if (result.length === 0) {
            return c.text('Failed to insert', 500);
        } else {
            return c.json(result[0]);
        }
    });

    // GET /post/:id
    app.get('/:id', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const clientConfig = c.get('clientConfig');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const id = c.req.param('id');
        const id_num = parseInt(id);
        const cacheKey = `post_${id}`;

        const post = await profileAsync(c, 'post_detail_cache_db', () => cache.getOrSet(cacheKey, () => db.query.posts.findFirst({
            where: or(eq(posts.id, id_num), eq(posts.alias, id)),
            with: {
                hashtags: {
                    columns: {},
                    with: {
                        hashtag: { columns: { id: true, name: true } }
                    }
                },
                user: { columns: { id: true, username: true, avatar: true } }
            }
        })));

        if (!post) {
            return c.text('Not found', 404);
        }

        if (post.draft && post.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        const { hashtags, ...other } = post;
        const hashtags_flatten = hashtags.map((f: any) => f.hashtag);

        // update visits using HyperLogLog for efficient UV estimation
        const enableVisit = await profileAsync(c, 'post_detail_counter_flag', () => clientConfig.getOrDefault('counter.enabled', true));
        let pv = 0;
        let uv = 0;

        if (enableVisit) {
            const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || "UNK";
            const visitorKey = `${ip}`;

            // Get or create visit stats for this post
            let stats = await profileAsync(c, 'post_detail_stats_lookup', () => db.query.visitStats.findFirst({
                where: eq(visitStats.postId, post.id)
            }));

            if (!stats) {
                // Create new stats record
                await profileAsync(c, 'post_detail_stats_insert', () => db.insert(visitStats).values({
                    postId: post.id,
                    pv: 1,
                    hllData: new HyperLogLog().serialize()
                }));
                pv = 1;
                uv = 1;
            } else {
                // Update existing stats
                const hll = new HyperLogLog(stats.hllData);
                hll.add(visitorKey);
                const newHllData = hll.serialize();
                const newPv = stats.pv + 1;

                await profileAsync(c, 'post_detail_stats_update', () => db.update(visitStats)
                    .set({
                        pv: newPv,
                        hllData: newHllData,
                        updatedAt: new Date()
                    })
                    .where(eq(visitStats.postId, post.id)));

                pv = newPv;
                uv = Math.round(hll.count());
            }

            // Keep recording to visits table for backup/history
            await profileAsync(c, 'post_detail_visit_insert', () => db.insert(visits).values({ postId: post.id, ip: ip }));
        }

        return c.json({ ...other, hashtags: hashtags_flatten, pv, uv });
    });

    // GET /post/adjacent/:id
    app.get("/adjacent/:id", async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const id = c.req.param('id');
        let id_num: number;

        if (isNaN(parseInt(id))) {
            const aliasRecord = await profileAsync(c, 'post_adjacent_alias_lookup', () => db.select({ id: posts.id }).from(posts).where(eq(posts.alias, id)));
            if (aliasRecord.length === 0) {
                return c.text("Not found", 404);
            }
            id_num = aliasRecord[0].id;
        } else {
            id_num = parseInt(id);
        }

        const post = await profileAsync(c, 'post_adjacent_current', () => db.query.posts.findFirst({
            where: eq(posts.id, id_num),
            columns: { createdAt: true },
        }));

        if (!post) {
            return c.text("Not found", 404);
        }

        const created_at = post.createdAt;

        function formatAndCacheData(post: any, postDirection: "previous_post" | "next_post") {
            if (post) {
                const hashtags_flatten = post.hashtags.map((f: any) => f.hashtag);
                const summary = post.summary.length > 0
                    ? post.summary
                    : post.content.length > 50
                        ? post.content.slice(0, 50)
                        : post.content;
                const cacheKey = `${post.id}_${postDirection}_${id_num}`;
                const cacheData = {
                    id: post.id,
                    title: post.title,
                    summary: summary,
                    hashtags: hashtags_flatten,
                    createdAt: post.createdAt,
                    updatedAt: post.updatedAt,
                };
                cache.set(cacheKey, cacheData);
                return cacheData;
            }
            return null;
        }

        const getPreviousPost = async () => {
            const previousPostCached = await profileAsync(c, 'post_adjacent_prev_cache', () => cache.getBySuffix(`previous_post_${id_num}`));
            if (previousPostCached && previousPostCached.length > 0) {
                return previousPostCached[0];
            } else {
                const tempPreviousPost = await profileAsync(c, 'post_adjacent_prev_db', () => db.query.posts.findFirst({
                    where: and(and(eq(posts.draft, 0), eq(posts.listed, 1)), lt(posts.createdAt, created_at)),
                    orderBy: [desc(posts.createdAt)],
                    with: {
                        hashtags: {
                            columns: {},
                            with: { hashtag: { columns: { id: true, name: true } } }
                        },
                        user: { columns: { id: true, username: true, avatar: true } }
                    },
                }));
                return formatAndCacheData(tempPreviousPost, "previous_post");
            }
        };

        const getNextPost = async () => {
            const nextPostCached = await profileAsync(c, 'post_adjacent_next_cache', () => cache.getBySuffix(`next_post_${id_num}`));
            if (nextPostCached && nextPostCached.length > 0) {
                return nextPostCached[0];
            } else {
                const tempNextPost = await profileAsync(c, 'post_adjacent_next_db', () => db.query.posts.findFirst({
                    where: and(and(eq(posts.draft, 0), eq(posts.listed, 1)), gt(posts.createdAt, created_at)),
                    orderBy: [asc(posts.createdAt)],
                    with: {
                        hashtags: {
                            columns: {},
                            with: { hashtag: { columns: { id: true, name: true } } }
                        },
                        user: { columns: { id: true, username: true, avatar: true } }
                    },
                }));
                return formatAndCacheData(tempNextPost, "next_post");
            }
        };

        const [previousPost, nextPost] = await Promise.all([getPreviousPost(), getNextPost()]);
        return c.json({ previousPost, nextPost });
    });

    // POST /post/:id - Update post
    app.post('/:id', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const serverConfig = c.get('serverConfig');
        const env = c.get('env');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const id = c.req.param('id');
        const body = await profileAsync(c, 'post_update_parse', () => c.req.json());
        const { title, listed, content, summary, alias, draft, top, tags, createdAt } = body;

        const id_num = parseInt(id);
        const post = await profileAsync(c, 'post_update_lookup', () => db.query.posts.findFirst({ where: eq(posts.id, id_num) }));

        if (!post) {
            return c.text('Not found', 404);
        }

        if (post.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        const contentChanged = content && content !== post.content;
        const isDraft = draft !== undefined ? draft : (post.draft === 1);
        const shouldQueueAISummary = (contentChanged && !isDraft) || (!isDraft && post.draft === 1 && !post.ai_summary);
        const updateTime = new Date();

        await profileAsync(c, 'post_update_db', () => db.update(posts).set({
            title,
            content,
            summary,
            ai_summary: shouldQueueAISummary ? "" : undefined,
            ai_summary_status: isDraft ? "idle" : undefined,
            ai_summary_error: shouldQueueAISummary || isDraft ? "" : undefined,
            alias,
            top,
            listed: listed ? 1 : 0,
            draft: draft === undefined ? undefined : draft ? 1 : 0,
            createdAt: createdAt ? new Date(createdAt) : undefined,
            updatedAt: updateTime
        }).where(eq(posts.id, id_num)));

        if (tags) {
            await profileAsync(c, 'post_update_tags', () => bindTagToPost(db, id_num, tags));
        }

        if (shouldQueueAISummary || isDraft) {
            await profileAsync(c, 'post_update_ai_queue', () => syncPostAISummaryQueueState(db, serverConfig, env, id_num, {
                draft: Boolean(isDraft),
                updatedAt: updateTime,
                resetSummary: shouldQueueAISummary,
            }));
        }

        await profileAsync(c, 'post_update_cache_invalidate', () => clearPostCache(cache, id_num, post.alias, alias || null));
        return c.text('Updated');
    });

    // POST /post/top/:id
    app.post('/top/:id', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const id = c.req.param('id');
        const body = await profileAsync(c, 'post_top_parse', () => c.req.json());
        const { top } = body;

        const id_num = parseInt(id);
        const post = await profileAsync(c, 'post_top_lookup', () => db.query.posts.findFirst({ where: eq(posts.id, id_num) }));

        if (!post) {
            return c.text('Not found', 404);
        }

        if (post.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        await profileAsync(c, 'post_top_db', () => db.update(posts).set({ top }).where(eq(posts.id, post.id)));
        await profileAsync(c, 'post_top_cache_invalidate', () => clearPostCache(cache, post.id, null, null));
        return c.text('Updated');
    });

    // DELETE /post/:id
    app.delete('/:id', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const id = c.req.param('id');

        const id_num = parseInt(id);
        const post = await profileAsync(c, 'post_delete_lookup', () => db.query.posts.findFirst({ where: eq(posts.id, id_num) }));

        if (!post) {
            return c.text('Not found', 404);
        }

        if (post.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        await profileAsync(c, 'post_delete_db', () => db.delete(posts).where(eq(posts.id, id_num)));
        await profileAsync(c, 'post_delete_cache_invalidate', () => clearPostCache(cache, id_num, post.alias, null));
        return c.text('Deleted');
    });
    return app;
}

export function SearchService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // GET /search/:keyword
    app.get('/:keyword', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const page = c.req.query('page');
        const limit = c.req.query('limit');
        let keyword = c.req.param('keyword');

        keyword = decodeURI(keyword);
        const page_num = (page ? parseInt(page) > 0 ? parseInt(page) : 1 : 1) - 1;
        const limit_num = limit ? parseInt(limit) > 50 ? 50 : parseInt(limit) : 20;

        if (keyword === undefined || keyword.trim().length === 0) {
            return c.json({ size: 0, data: [], hasNext: false });
        }

        const cacheKey = `search_${keyword}`;
        const searchKeyword = `%${keyword}%`;
        const whereClause = or(
            like(posts.title, searchKeyword),
            like(posts.content, searchKeyword),
            like(posts.summary, searchKeyword),
            like(posts.alias, searchKeyword)
        );

        const env = c.get('env');
        const requestOrigin = new URL(c.req.url).origin;

        // Use a separate cache key for processed results (with R2 thumbnail URLs)
        const processedCacheKey = `${cacheKey}_processed`;
        const cachedProcessed = await profileAsync(c, 'post_search_processed_cache_get', () => cache.get(processedCacheKey));

        let post_list: any[];

        if (cachedProcessed) {
            post_list = cachedProcessed;
        } else {
            const rawList = await profileAsync(c, 'post_search_cache_db', () => cache.getOrSet(cacheKey, () => db.query.posts.findMany({
                where: admin ? whereClause : and(whereClause, eq(posts.draft, 0)),
                columns: admin ? undefined : { draft: false, listed: false },
                with: {
                    hashtags: {
                        columns: {},
                        with: { hashtag: { columns: { id: true, name: true } } }
                    },
                    user: { columns: { id: true, username: true, avatar: true } }
                },
                orderBy: [desc(posts.createdAt), desc(posts.updatedAt)],
            })));

            // Upload external thumbnails to R2/S3 in parallel
            post_list = await Promise.all(rawList.map(async ({ content, hashtags, summary, ...other }: any) => {
                const avatar = await extractAndEnsureThumbnail(content, env, requestOrigin);
                return {
                    summary: summary.length > 0 ? summary : content.length > 100 ? content.slice(0, 100) : content,
                    hashtags: hashtags.map(({ hashtag }: any) => hashtag),
                    avatar,
                    ...other
                };
            }));

            // Cache processed results (with R2 URLs) to avoid re-uploading on subsequent requests
            await profileAsync(c, 'post_search_processed_cache_set', () => cache.set(processedCacheKey, post_list));
        }

        if (post_list.length <= page_num * limit_num) {
            return c.json({ size: post_list.length, data: [], hasNext: false });
        } else if (post_list.length <= page_num * limit_num + limit_num) {
            return c.json({ size: post_list.length, data: post_list.slice(page_num * limit_num), hasNext: false });
        } else {
            return c.json({
                size: post_list.length,
                data: post_list.slice(page_num * limit_num, page_num * limit_num + limit_num),
                hasNext: true
            });
        }
    });
    return app;
}


export function WordPressService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // POST /wp - WordPress import
    app.post('/', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const body = await profileAsync(c, 'wp_import_parse', () => c.req.parseBody());
        const data = body.data as File;

        if (!admin) {
            return c.text('Permission denied', 403);
        }

        if (!data) {
            return c.text('Data is required', 400);
        }

        // Initialize WordPress import modules lazily
        await profileAsync(c, 'wp_import_modules', () => initWPModules());

        const xml = await profileAsync(c, 'wp_import_read', () => data.text());
        const parser = new XMLParser();
        const result = await profileAsync(c, 'wp_import_xml_parse', () => parser.parse(xml));
        const items = result.rss.channel.item;

        if (!items) {
            return c.text('No items found', 404);
        }

        const postItems: PostItem[] = items?.map((item: any) => {
            const createdAt = new Date(item?.['wp:post_date']);
            const updatedAt = new Date(item?.['wp:post_modified']);
            const draft = item?.['wp:status'] !== 'publish';
            const contentHtml = item?.['content:encoded'];
            const content = html2md(contentHtml);
            const summary = content.length > 100 ? content.slice(0, 100) : content;
            let tags = item?.['category'];

            if (tags && Array.isArray(tags)) {
                tags = tags.map((tag: any) => tag + '');
            } else if (tags && typeof tags === 'string') {
                tags = [tags];
            }

            return {
                title: item.title,
                summary,
                content,
                draft,
                createdAt,
                updatedAt,
                tags
            };
        });

        let success = 0;
        let skipped = 0;
        let skippedList: { title: string, reason: string }[] = [];

        for (const item of postItems) {
            if (!item.content) {
                skippedList.push({ title: item.title, reason: "no content" });
                skipped++;
                continue;
            }

            const exist = await profileAsync(c, 'wp_import_existing', () => db.query.posts.findFirst({ where: eq(posts.content, item.content) }));
            if (exist) {
                skippedList.push({ title: item.title, reason: "content exists" });
                skipped++;
                continue;
            }

            const result = await profileAsync(c, 'wp_import_insert', () => db.insert(posts).values({
                title: item.title,
                content: item.content,
                summary: item.summary,
                uid: 1,
                listed: 1,
                draft: item.draft ? 1 : 0,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            }).returning({ insertedId: posts.id }));

            if (item.tags) {
                const tags = item.tags;
                await profileAsync(c, 'wp_import_tags', () => bindTagToPost(db, result[0].insertedId, tags));
            }
            success++;
        }

        await profileAsync(c, 'wp_import_cache_invalidate', () => cache.deletePrefix('posts_'));
        return c.json({ success, skipped, skippedList });
    });
    return app;
}

type PostItem = {
    title: string;
    summary: string;
    content: string;
    draft: boolean;
    createdAt: Date;
    updatedAt: Date;
    tags?: string[];
}