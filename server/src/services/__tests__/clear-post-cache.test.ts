import { describe, expect, it } from 'bun:test';

import { clearPostCache } from '../clear-post-cache';

describe('clearPostCache', () => {
    it('deletes alias cache when alias is unchanged', async () => {
        const deletedPrefixes: string[] = [];
        const deletedKeys: Array<{ key: string; save: boolean | undefined }> = [];
        const cache = {
            async deletePrefix(prefix: string) {
                deletedPrefixes.push(prefix);
            },
            async delete(key: string, save?: boolean) {
                deletedKeys.push({ key, save });
            }
        } as any;

        await clearPostCache(cache, 42, 'about', 'about');

        expect(deletedPrefixes).toEqual([
            'posts_',
            'search_',
            '42_previous_post',
            '42_next_post'
        ]);
        expect(deletedKeys).toEqual([
            { key: 'post_42', save: false },
            { key: 'post_about', save: false }
        ]);
    });

    it('deletes both old and new alias cache keys when alias changes', async () => {
        const deletedKeys: Array<{ key: string; save: boolean | undefined }> = [];
        const cache = {
            async deletePrefix() {},
            async delete(key: string, save?: boolean) {
                deletedKeys.push({ key, save });
            }
        } as any;

        await clearPostCache(cache, 42, 'about', 'about-us');

        expect(deletedKeys).toEqual([
            { key: 'post_42', save: false },
            { key: 'post_about', save: false },
            { key: 'post_about-us', save: false }
        ]);
    });
});
