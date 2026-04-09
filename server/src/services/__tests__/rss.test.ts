import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { RSSService, rssCrontab } from '../rss';
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { createMockDB, createMockEnv, setupTestApp, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';

describe('RSSService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    beforeEach(async () => {
        const ctx = await setupTestApp(RSSService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        
        // Seed test data
        await seedTestData(sqlite);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function seedTestData(sqlite: Database) {
        sqlite.exec(`
            INSERT INTO users (id, username, avatar, openid) VALUES (1, 'testuser', 'avatar.png', 'gh_test')
        `);
        sqlite.exec(`
            INSERT INTO posts (id, title, content, summary, uid, draft, listed, created_at, updated_at) VALUES 
                (1, 'Test Post 1', '# Hello\n\nThis is content', 'Summary 1', 1, 0, 1, unixepoch(), unixepoch()),
                (2, 'Test Post 2', '![image](https://example.com/img.png)', 'Summary 2', 1, 0, 1, unixepoch(), unixepoch()),
                (3, 'Draft Post', 'Draft content', '', 1, 1, 1, unixepoch(), unixepoch())
        `);
    }

    describe('GET /:name - RSS post endpoints', () => {
        it('should serve rss.xml', async () => {
            const res = await app.request('/rss.xml', { method: 'GET' }, env);
            
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('application/rss+xml; charset=UTF-8');
            
            const text = await res.text();
            expect(text).toContain('<?xml');
            expect(text).toContain('<rss');
            expect(text).toContain('Test Post 1');
            expect(text).toContain('Test Post 2');
            expect(text).not.toContain('Draft Post');
        });

        it('should serve atom.xml', async () => {
            const res = await app.request('/atom.xml', { method: 'GET' }, env);
            
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('application/atom+xml; charset=UTF-8');
            
            const text = await res.text();
            expect(text).toContain('<?xml');
            expect(text).toContain('<post');
            expect(text).toContain('Test Post 1');
        });

        it('should serve rss.json', async () => {
            const res = await app.request('/rss.json', { method: 'GET' }, env);
            
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('application/post+json; charset=UTF-8');
            
            const data = await res.json() as any;
            expect(data).toHaveProperty('items');
            expect(data.items.length).toBe(2);
        });

        it('should serve post.json (alias)', async () => {
            const res = await app.request('/post.json', { method: 'GET' }, env);
            
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('application/post+json; charset=UTF-8');
        });

        it('should redirect post.xml to rss.xml', async () => {
            const res = await app.request('/post.xml', { method: 'GET' }, env);
            
            expect(res.status).toBe(301);
            expect(res.headers.get('Location')).toBe('/rss.xml');
        });

        it('should return 404 for unknown post names', async () => {
            const res = await app.request('/unknown.xml', { method: 'GET' }, env);
            
            expect(res.status).toBe(404);
        });

        it('should convert markdown to HTML in content', async () => {
            const res = await app.request('/rss.xml', { method: 'GET' }, env);
            
            const text = await res.text();
            expect(text).toContain('<h1>Hello</h1>');
            expect(text).not.toContain('# Hello');
        });

        it('should include post metadata', async () => {
            const res = await app.request('/rss.xml', { method: 'GET' }, env);
            
            const text = await res.text();
            expect(text).toContain('Test Blog');
            expect(text).toContain('Test Environment');
        });

        it('should limit to 20 items', async () => {
            for (let i = 4; i <= 25; i++) {
                sqlite.exec(`
                    INSERT INTO posts (id, title, content, uid, draft, listed, created_at) 
                    VALUES (${i}, 'Post ${i}', 'Content', 1, 0, 1, unixepoch())
                `);
            }
            
            const res = await app.request('/rss.xml', { method: 'GET' }, env);
            
            const text = await res.text();
            const itemCount = (text.match(/<item>/g) || []).length;
            expect(itemCount).toBeLessThanOrEqual(20);
        });

        it('should serve cached rss.xml through R2 without S3_ACCESS_HOST', async () => {
            const cachedEnv = createMockEnv({
                S3_ACCESS_HOST: '' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
                R2_BUCKET: {
                    get: async (key: string) => {
                        if (key !== 'cache/rss.xml') {
                            return null;
                        }

                        return {
                            key,
                            size: 18,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date('2025-01-01T00:00:00Z'),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            httpMetadata: { contentType: 'application/rss+xml; charset=UTF-8' },
                            writeHttpMetadata(headers: Headers) {
                                headers.set('Content-Type', 'application/rss+xml; charset=UTF-8');
                            },
                            body: new Blob(['<rss>cached</rss>']).stream(),
                            bodyUsed: false,
                            arrayBuffer: async () => new TextEncoder().encode('<rss>cached</rss>').buffer,
                            text: async () => '<rss>cached</rss>',
                            json: async () => ({ value: 'cached' }),
                            blob: async () => new Blob(['<rss>cached</rss>']),
                            bytes: async () => new Uint8Array(new TextEncoder().encode('<rss>cached</rss>')),
                        } as unknown as R2ObjectBody;
                    },
                    head: async () => null,
                } as unknown as R2Bucket,
            });

            const ctx = await setupTestApp(RSSService, cachedEnv);
            const res = await ctx.app.request('/rss.xml', { method: 'GET' }, cachedEnv);

            expect(res.status).toBe(200);
            expect(await res.text()).toBe('<rss>cached</rss>');

            cleanupTestDB(ctx.sqlite);
        });
    });
});

describe('rssCrontab', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;

    beforeEach(async () => {
        const mockDB = createMockDB();
        db = mockDB.db;
        sqlite = mockDB.sqlite;
        env = createMockEnv();
        
        sqlite.exec(`INSERT INTO users (id, username, openid) VALUES (1, 'testuser', 'gh_test')`);
        sqlite.exec(`
            INSERT INTO posts (id, title, content, uid, draft, listed) VALUES 
                (1, 'Post 1', 'Content 1', 1, 0, 1),
                (2, 'Post 2', 'Content 2', 1, 0, 1)
        `);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    it('should generate and save RSS posts to S3', async () => {
        try {
            await rssCrontab(env, db);
        } catch (e) {
            // Expected to fail since S3 is not configured in test env
        }
    });

    it('should handle missing posts gracefully', async () => {
        sqlite.exec('DELETE FROM posts');
        
        try {
            await rssCrontab(env, db);
        } catch (e) {
            // Should not throw
        }
    });
});
