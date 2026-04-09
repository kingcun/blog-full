import { listContentImageUrls, stripImageMetadataFromUrl } from "./image";
import { putStorageObject } from "./storage";

/**
 * Checks if a URL is already hosted on R2/S3 storage (not an external URL).
 */
function isStorageUrl(url: string, env: Env): boolean {
    if (!url) return false;

    // If using S3_ACCESS_HOST, check if URL starts with it
    if (env.S3_ACCESS_HOST && url.startsWith(env.S3_ACCESS_HOST)) {
        return true;
    }

    // If using S3_ENDPOINT, check if URL starts with it
    if (env.S3_ENDPOINT && url.startsWith(env.S3_ENDPOINT)) {
        return true;
    }

    // Check for blob URL (local storage via BlobService)
    if (url.startsWith("/api/blob/") || url.includes("/api/blob/")) {
        return true;
    }

    // Check for relative URLs (already internal)
    if (url.startsWith("/") && !url.startsWith("//")) {
        return true;
    }

    return false;
}

/**
 * Given a raw image URL from post content, fetch it (if external) and upload to R2/S3,
 * then return the storage URL. Returns the original URL if it's already on storage,
 * or if storage is not configured / upload fails.
 *
 * @param url      The image URL (may include #metadata fragment).
 * @param env      Cloudflare Worker environment bindings.
 * @param baseUrl  The origin URL of the request (used to build blob URLs when no public host is set).
 * @returns        A storage URL, or the original URL as fallback.
 */
export async function ensureThumbnailOnStorage(
    url: string,
    env: Env,
    baseUrl?: string,
): Promise<string> {
    // Strip metadata fragment (#blurhash=...&width=...&height=...) to get the clean src
    const [cleanUrl, fragment] = url.split("#", 2);

    if (!cleanUrl) return url;

    // Already on storage — return as-is (preserve original with metadata fragment)
    if (isStorageUrl(cleanUrl, env)) {
        return url;
    }

    // If no storage is configured, skip upload and return original URL directly
    const hasStorage = Boolean(env.R2_BUCKET || env.S3_ENDPOINT);
    if (!hasStorage) {
        return url;
    }

    try {
        // Fetch the external image
        const response = await fetch(cleanUrl, {
            headers: {
                "User-Agent": "RinBlog/1.0 (thumbnail-fetcher)",
            },
            // Cloudflare Workers: use cf cache
            // @ts-ignore
            cf: { cacheTtl: 3600 },
        });

        if (!response.ok) {
            console.warn(`[thumbnail] Failed to fetch ${cleanUrl}: ${response.status}`);
            return url;
        }

        const contentType = response.headers.get("content-type") || "image/jpeg";
        // Only handle image types
        if (!contentType.startsWith("image/")) {
            return url;
        }

        const imageBuffer = await response.arrayBuffer();

        // Build a deterministic storage key from the URL hash so we don't re-upload
        const encoder = new TextEncoder();
        const urlBytes = encoder.encode(cleanUrl);
        const hashBuffer = await crypto.subtle.digest("SHA-1", urlBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

        // Determine extension from content-type
        const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
        const storageKey = `thumbnails/${hash}.${ext}`;

        // Upload to R2/S3
        const result = await putStorageObject(env, storageKey, imageBuffer, contentType, baseUrl);

        // Re-attach metadata fragment if it existed
        return fragment ? `${result.url}#${fragment}` : result.url;
    } catch (err) {
        console.error(`[thumbnail] Error uploading thumbnail for ${cleanUrl}:`, err);
        // Always fall back to the original URL so the image still shows
        return url;
    }
}

/**
 * Extract the first image from post content (supports both Markdown and HTML img tags)
 * and ensure it is stored on R2/S3.
 *
 * Falls back to the original URL when storage is not configured or upload fails,
 * so the image always renders even in local/dev environments.
 *
 * Returns undefined only when the post has NO images at all.
 */
export async function extractAndEnsureThumbnail(
    content: string,
    env: Env,
    baseUrl?: string,
): Promise<string | undefined> {
    // listContentImageUrls checks both Markdown ![alt](url) and HTML <img src="...">
    const urls = listContentImageUrls(content);
    if (urls.length === 0) return undefined;

    // Use the first image found (with its original metadata fragment intact)
    const rawUrl = urls[0];

    return ensureThumbnailOnStorage(rawUrl, env, baseUrl);
}