import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { posts, users } from "../db/schema";
import { extractImage } from "../utils/image";
import { path_join } from "../utils/path";
import { getStorageObject, getStoragePublicUrl, headStorageObject, putStorageObjectAtKey } from "../utils/storage";
import { FAVICON_ALLOWED_TYPES, getFaviconKey } from "./favicon";
import type { DB } from "../core/hono-types";

// Lazy-loaded modules for RSS generation
let Post: any;
let unified: any;
let remarkParse: any;
let remarkGfm: any;
let remarkRehype: any;
let rehypeStringify: any;

async function initRSSModules() {
    if (!unified) {
        const unifiedMod = await import("unified");
        const remarkParseMod = await import("remark-parse");
        const remarkGfmMod = await import("remark-gfm");
        const remarkRehypeMod = await import("remark-rehype");
        const rehypeStringifyMod = await import("rehype-stringify");
        
        unified = unifiedMod.unified;
        remarkParse = remarkParseMod.default;
        remarkGfm = remarkGfmMod.default;
        remarkRehype = remarkRehypeMod.default;
        rehypeStringify = rehypeStringifyMod.default;
    }
}

export function RSSService(): Hono {
    const app = new Hono();

    // GET /rss.xml
    app.get('/rss.xml', async (c: AppContext) => {
        return handlePost(c, 'rss.xml');
    });

    // GET /atom.xml
    app.get('/atom.xml', async (c: AppContext) => {
        return handlePost(c, 'atom.xml');
    });

    // GET /rss.json
    app.get('/rss.json', async (c: AppContext) => {
        return handlePost(c, 'rss.json');
    });

    // GET /post.json
    app.get('/post.json', async (c: AppContext) => {
        return handlePost(c, 'post.json');
    });

    // Support legacy post.xml - redirect to rss.xml
    app.get('/post.xml', async (c: AppContext) => {
        return c.redirect('/rss.xml', 301);
    });

    return app;
}

/**
 * Proxy endpoint: GET /api/fetch-feed?url=<encoded_url>
 * Fetches an external RSS/Atom feed or article URL on behalf of the browser
 * to bypass CORS restrictions. Only accessible by authenticated admins.
 */
export function FetchFeedProxy(): Hono {
    const app = new Hono();

    app.get('/fetch-feed', async (c: AppContext) => {
        const admin = c.get('admin');
        if (!admin) {
            return c.text('Permission denied', 403);
        }

        const url = c.req.query('url');

        if (!url) {
            return c.text('Missing url parameter', 400);
        }

        // Basic URL validation — only allow http/https
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return c.text('Invalid URL', 400);
        }

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return c.text('Only http and https URLs are allowed', 400);
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; RinBlog/1.0; +https://github.com/yanhh3d/rin)',
                    // Accept images too so the proxy works for RSS content images
                    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, image/*, */*',
                },
            });

            if (!response.ok) {
                return c.text(`Upstream error: ${response.status} ${response.statusText}`, 502);
            }

            const contentType = response.headers.get('content-type') || 'application/octet-stream';

            // Stream the body as-is — do NOT call .text() which corrupts binary data (images, etc.)
            return new Response(response.body, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store',
                },
            });
        } catch (err: any) {
            console.error('[FetchFeedProxy] Error fetching URL:', url, err);
            return c.text(`Failed to fetch URL: ${err.message}`, 502);
        }
    });

    return app;
}

async function handlePost(c: AppContext, fileName: string) {
    const env = c.get('env');
    const db = c.get('db');

    const folder = env.S3_CACHE_FOLDER || 'cache/';

    // Map file extensions to proper MIME types
    const contentTypeMap: Record<string, string> = {
        'rss.xml': 'application/rss+xml; charset=UTF-8',
        'atom.xml': 'application/atom+xml; charset=UTF-8',
        'rss.json': 'application/post+json; charset=UTF-8',
        'post.json': 'application/post+json; charset=UTF-8',
    };
    const contentType = contentTypeMap[fileName] || 'application/xml';

    // Try to fetch from S3 first (if configured)
    const key = path_join(folder, fileName);
    
    try {
        const response = await profileAsync(c, 'rss_s3_fetch', () => getStorageObject(env, key));

        if (response) {
            console.log(`[RSS] Storage hit for ${key}`);
            const text = await profileAsync(c, 'rss_s3_body', () => response.text());
            return c.text(text, 200, {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600',
            });
        }
    } catch (e: any) {
        console.log(`[RSS] Storage fetch failed: ${e.message}, falling back to generation`);
    }
    
    // Generate post in real-time (fallback or primary mode)
    try {
        console.log(`[RSS] Generating ${fileName} in real-time...`);
        const frontendUrl = new URL(c.req.url).origin;
        const post = await profileAsync(c, 'rss_generate_post', () => generatePost(env, db, frontendUrl, c));
        
        let content: string;
        switch (fileName) {
            case 'rss.xml':
                content = await profileAsync(c, 'rss_render_rss2', () => Promise.resolve(post.rss2()));
                break;
            case 'atom.xml':
                content = await profileAsync(c, 'rss_render_atom', () => Promise.resolve(post.atom1()));
                break;
            case 'rss.json':
            case 'post.json':
                content = await profileAsync(c, 'rss_render_json', () => Promise.resolve(post.json1()));
                break;
            default:
                content = await profileAsync(c, 'rss_render_default', () => Promise.resolve(post.rss2()));
        }
        
        return c.text(content, 200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=300', // Shorter cache for real-time
        });
    } catch (genError: any) {
        console.error('[RSS] Generation failed:', genError);
        return c.text(`RSS generation failed: ${genError.message}`, 500);
    }
}

// Extract post generation logic for reuse
async function generatePost(env: Env, db: DB, frontendUrl: string, c?: AppContext) {
    if (c) {
        await profileAsync(c, 'rss_init_modules', () => initRSSModules());
    } else {
        await initRSSModules();
    }
    const faviconKey = getFaviconKey(env);
    const publicBaseUrl = frontendUrl || undefined;

    let postConfig: any = {
        title: env.RSS_TITLE,
        description: env.RSS_DESCRIPTION || "Post from Rin",
        id: frontendUrl,
        link: frontendUrl,
        copyright: "All rights reserved 2024",
        updated: new Date(),
        generator: "Post from Rin",
        postLinks: {
            // Native RSS support - posts are now served from root path
            rss: `${frontendUrl}/rss.xml`,
            json: `${frontendUrl}/rss.json`,
            atom: `${frontendUrl}/atom.xml`,
        },
    };

    if (!postConfig.title) {
        const user = c
            ? await profileAsync(c, 'rss_user_lookup', () => db.query.users.findFirst({ where: eq(users.id, 1) }))
            : await db.query.users.findFirst({ where: eq(users.id, 1) });
        if (user) {
            postConfig.title = user.username;
        }
    }

    // Try to discover stored favicon assets.
    for (const [_mimeType, ext] of Object.entries(FAVICON_ALLOWED_TYPES)) {
        const originFaviconKey = path_join(env.S3_FOLDER || "", `originFavicon${ext}`);
        try {
            const response = c
                ? await profileAsync(c, 'rss_origin_favicon_fetch', () => headStorageObject(env, originFaviconKey))
                : await headStorageObject(env, originFaviconKey);
            if (response) {
                postConfig.image = getStoragePublicUrl(env, originFaviconKey, publicBaseUrl);
                break;
            }
        } catch (error) {
            continue;
        }
    }

    try {
        const response = c
            ? await profileAsync(c, 'rss_favicon_fetch', () => headStorageObject(env, faviconKey))
            : await headStorageObject(env, faviconKey);
        if (response) {
            postConfig.favicon = getStoragePublicUrl(env, faviconKey, publicBaseUrl);
        }
    } catch (error) { }

    const post = new Post(postConfig);

    // Get published posts
    const post_list = c
        ? await profileAsync(c, 'rss_post_list', () => db.query.posts.findMany({
            where: and(eq(posts.draft, 0), eq(posts.listed, 1)),
            orderBy: [desc(posts.createdAt), desc(posts.updatedAt)],
            limit: 20,
            with: {
                user: { columns: { id: true, username: true, avatar: true } },
            },
        }))
        : await db.query.posts.findMany({
        where: and(eq(posts.draft, 0), eq(posts.listed, 1)),
        orderBy: [desc(posts.createdAt), desc(posts.updatedAt)],
        limit: 20,
        with: {
            user: { columns: { id: true, username: true, avatar: true } },
        },
    });

    for (const f of post_list) {
        const { summary, content, user, ...other } = f;
        
        // Convert markdown to HTML
        let contentHtml = '';
        if (content) {
            try {
                const file = await unified()
                    .use(remarkParse)
                    .use(remarkGfm)
                    .use(remarkRehype)
                    .use(rehypeStringify)
                    .process(content);
                contentHtml = file.toString();
            } catch (e) {
                console.error('[RSS] Markdown conversion error:', e);
                contentHtml = content;
            }
        }

        post.addItem({
            title: other.title || "No title",
            id: other.id?.toString() || "0",
            link: `${frontendUrl}/post/${other.id}`,
            date: other.createdAt,
            description: summary.length > 0
                ? summary
                : content.length > 100
                    ? content.slice(0, 100)
                    : content,
            content: contentHtml,
            author: user ? [{ name: user.username }] : undefined,
            image: extractImage(content),
        });
    }
    
    return post;
}

export async function rssCrontab(env: Env, db: DB) {
    // Generate post
    // For cron jobs, we don't have a request context, so we use a placeholder
    // The RSS posts generated by cron jobs will be stored in S3 and served from there
    const frontendUrl = '';
    const post = await generatePost(env, db, frontendUrl);
    
    // Save to S3 (if configured)
    const folder = env.S3_CACHE_FOLDER || "cache/";

    async function save(name: string, data: string) {
        const hashkey = path_join(folder, name);
        try {
            await putStorageObjectAtKey(
                env,
                hashkey,
                data,
                name.endsWith('.json') ? 'application/json' : 'application/xml'
            );
            console.log(`[RSS] Saved ${name} to S3`);
        } catch (e: any) {
            console.error(`[RSS] Failed to save ${name}:`, e.message);
        }
    }

    await save("rss.xml", post.rss2());
    await save("atom.xml", post.atom1());
    await save("rss.json", post.json1());
}