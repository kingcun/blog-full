import type { CacheImpl } from "../core/hono-types";

export async function clearPostCache(cache: CacheImpl, id: number, alias: string | null, newAlias: string | null) {
    await cache.deletePrefix('posts_');
    await cache.deletePrefix('search_');
    await cache.delete(`post_${id}`, false);
    await cache.deletePrefix(`${id}_previous_post`);
    await cache.deletePrefix(`${id}_next_post`);
    if (alias) await cache.delete(`post_${alias}`, false);
    if (newAlias && newAlias !== alias) await cache.delete(`post_${newAlias}`, false);
}
