import { eq } from "drizzle-orm";
import { posts, hashtags, postHashtags } from "../db/schema";
import type { DB } from "../core/hono-types";
import { putStorageObject } from "../utils/storage";

// ──────────────────────────────────────────────
// Danh sách feed cron tự động kéo về
// ──────────────────────────────────────────────
const FEED_SOURCES: Array<{ url: string; uid: number }> = [
  // { url: "https://techcrunch.com/feed/", uid: 1 },
  // Thêm các feed muốn kéo ở đây
];

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface ParsedFeedItem {
  title: string;
  link: string;
  description: string; // plain text summary
  contentHtml: string; // raw HTML content
  pubDate: string;
  guid: string;
  categories: string[];
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

const SUPPORTED_IMAGE_EXTS = new Set(Object.keys(IMAGE_MIME_BY_EXT));

// ──────────────────────────────────────────────
// Cron entry point
// ──────────────────────────────────────────────
export async function feedCrontab(env: Env, db: DB) {
  if (FEED_SOURCES.length === 0) return;

  let html2md: any;
  try {
    const h2m = await import("html-to-md");
    html2md = h2m.default;
  } catch {
    console.error("[FeedImporter] html-to-md not available");
    return;
  }

  for (const source of FEED_SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: { "User-Agent": "RinBlog/1.0 (feed-importer)" },
      });
      if (!res.ok) {
        console.error(`[FeedImporter] Failed to fetch ${source.url}: ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const items = parseFeedXml(xml);
      const baseUrl = new URL(source.url).origin;

      for (const item of items.slice(0, 10)) {
        await importFeedItem(item, source.uid, env, db, html2md, baseUrl);
      }
    } catch (e) {
      console.error(`[FeedImporter] Error processing ${source.url}:`, e);
    }
  }
}

// ──────────────────────────────────────────────
// Import một item vào D1
// ──────────────────────────────────────────────
async function importFeedItem(
  item: ParsedFeedItem,
  uid: number,
  env: Env,
  db: DB,
  html2md: any,
  baseUrl: string,
) {
  const alias = slugify(item.guid || item.link);

  // Kiểm tra trùng
  const exists = await db.query.posts.findFirst({
    where: eq(posts.alias, alias),
  });
  if (exists) return;

  // Upload tất cả ảnh trong content lên R2 rồi thay src
  const contentWithLocalImages = await reuploadImagesInHtml(item.contentHtml || item.description, env, baseUrl);

  // Convert HTML → Markdown
  let markdown = "";
  try {
    markdown = html2md(contentWithLocalImages);
  } catch {
    markdown = stripHtml(contentWithLocalImages);
  }

  // Summary (plain text, tối đa 200 ký tự)
  const summary = stripHtml(item.description || item.contentHtml).slice(0, 200);

  // Tìm ảnh đầu tiên làm thumbnail (avatar)
  const firstImage = extractFirstImageSrc(contentWithLocalImages);

  await db.insert(posts).values({
    title: item.title || "Untitled",
    summary,
    content: firstImage
      ? `![thumbnail](${firstImage})\n\n${markdown}`
      : markdown,
    alias,
    uid,
    draft: 0,
    listed: 1,
  });

  // Gắn hashtag từ categories
  if (item.categories.length > 0) {
    const post = await db.query.posts.findFirst({ where: eq(posts.alias, alias) });
    if (post) {
      await attachCategories(item.categories.slice(0, 5), post.id, db);
    }
  }

  console.log(`[FeedImporter] Imported: ${item.title}`);
}

// ──────────────────────────────────────────────
// Gắn categories thành hashtag
// ──────────────────────────────────────────────
async function attachCategories(categories: string[], postId: number, db: DB) {
  for (const name of categories) {
    const tagName = name.toLowerCase().trim().replace(/\s+/g, "-").slice(0, 50);
    if (!tagName) continue;

    let tag = await db.query.hashtags.findFirst({ where: eq(hashtags.name, tagName) });
    if (!tag) {
      const [inserted] = await db.insert(hashtags).values({ name: tagName }).returning();
      tag = inserted;
    }
    if (!tag) continue;

    const existing = await db.query.postHashtags.findFirst({
      where: (t, { and }) => and(eq(t.postId, postId), eq(t.hashtagId, tag!.id)),
    });
    if (!existing) {
      await db.insert(postHashtags).values({ postId, hashtagId: tag.id });
    }
  }
}

// ──────────────────────────────────────────────
// Upload tất cả ảnh trong HTML lên R2
// ──────────────────────────────────────────────
export async function reuploadImagesInHtml(html: string, env: Env, baseUrl?: string): Promise<string> {
  if (!html) return html;

  const hasStorage = Boolean(env.R2_BUCKET || env.S3_ENDPOINT);
  if (!hasStorage) return html;

  const imgTagPattern = /<img\b[^>]*>/gi;
  const matches = [...html.matchAll(imgTagPattern)];

  const replacements = new Map<string, string>();

  await Promise.all(
    matches.map(async (match) => {
      const originalTag = match[0];
      const originalSrc = getPreferredImageSrc(originalTag);
      if (!originalSrc || originalSrc.startsWith("data:") || originalSrc.startsWith("/")) return;

      try {
        const res = await fetch(originalSrc, {
          headers: { "User-Agent": "RinBlog/1.0 (image-reupload)" },
          // @ts-ignore
          cf: { cacheTtl: 3600 },
        });
        if (!res.ok) return;

        let contentType = res.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) return;

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength === 0) return;

        // Hash để tránh upload trùng
        const encoder = new TextEncoder();
        const hash = await crypto.subtle.digest("SHA-1", encoder.encode(originalSrc));
        const hashHex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");

        const urlExt = getImageExtensionFromUrl(originalSrc);
        if (urlExt === "svg") return;

        let ext = urlExt && SUPPORTED_IMAGE_EXTS.has(urlExt) ? normalizeImageExtension(urlExt) : "";
        if (!ext) {
          ext = normalizeImageExtension(contentType.split("/")[1]?.split("+")[0]?.split(";")[0] ?? "jpg");
        }
        if (!SUPPORTED_IMAGE_EXTS.has(ext)) return;

        contentType = IMAGE_MIME_BY_EXT[ext] ?? contentType;
        const storageKey = `feed-images/${hashHex}.${ext}`;

        const result = await putStorageObject(env, storageKey, buffer, contentType, baseUrl);
        replacements.set(originalTag, replaceImageTagSrc(originalTag, result.url));
      } catch (e) {
        console.warn(`[FeedImporter] Failed to reupload image ${originalSrc}:`, e);
      }
    }),
  );

  return html.replace(imgTagPattern, (tag) => replacements.get(tag) ?? tag);
}

// ──────────────────────────────────────────────
// Parse RSS / Atom XML thủ công (không dùng lib)
// ──────────────────────────────────────────────
export function parseFeedXml(xml: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];

  // Thử RSS <item>
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const categories = extractAllTags(block, "category");

    items.push({
      title: decodeEntities(extractCdata(block, "title") || extractTag(block, "title")),
      link: extractLinkFromBlock(block),
      description: extractCdata(block, "description") || extractTag(block, "description"),
      contentHtml: extractCdata(block, "content:encoded") || extractCdata(block, "description") || extractTag(block, "description"),
      pubDate: extractTag(block, "pubDate") || extractTag(block, "dc:date") || "",
      guid: extractCdata(block, "guid") || extractTag(block, "guid") || "",
      categories,
    });
  }

  if (items.length > 0) return items;

  // Thử Atom <entry>
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
    const link = linkMatch?.[1] || "";

    items.push({
      title: decodeEntities(extractCdata(block, "title") || extractTag(block, "title")),
      link,
      description: extractCdata(block, "summary") || extractTag(block, "summary") || "",
      contentHtml: extractCdata(block, "content") || extractTag(block, "content") || extractCdata(block, "summary") || "",
      pubDate: extractTag(block, "published") || extractTag(block, "updated") || "",
      guid: extractTag(block, "id") || link,
      categories: extractAllTags(block, "category"),
    });
  }

  return items;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function extractCdata(xml: string, tag: string): string {
  const escapedTag = tag.replace(":", "\\:");
  const m = xml.match(new RegExp(`<${escapedTag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escapedTag}>`, "i"));
  return m?.[1]?.trim() ?? "";
}

function extractTag(xml: string, tag: string): string {
  const escapedTag = tag.replace(":", "\\:");
  const m = xml.match(new RegExp(`<${escapedTag}[^>]*>([^<]*)<\\/${escapedTag}>`, "i"));
  return m?.[1]?.trim() ?? "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const val = (m[1] || m[2] || "").trim();
    if (val) results.push(val);
  }
  return results;
}

function extractLinkFromBlock(block: string): string {
  // Ưu tiên <link>...</link>
  const cdataLink = extractCdata(block, "link");
  if (cdataLink) return cdataLink;

  // <link href="..."> (Atom style)
  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch) return hrefMatch[1];

  // <link>text</link>
  const textLink = extractTag(block, "link");
  if (textLink) return textLink;

  // Lấy text node sau <link/>
  const afterLink = block.match(/<link\s*\/?>\s*([^\s<][^<]*)/i);
  return afterLink?.[1]?.trim() ?? "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#\d+;/g, "");
}

function extractFirstImageSrc(html: string): string | undefined {
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = getPreferredImageSrc(match[0]);
    if (src && !src.startsWith("data:") && !src.startsWith("/")) {
      return src;
    }
  }

  return undefined;
}

function extractAttribute(tag: string, attribute: string): string {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escapedAttribute}=["']([^"']+)["']`, "i"));
  return match?.[1]?.trim() ?? "";
}

function getPreferredImageSrc(tag: string): string {
  const candidates = [
    extractAttribute(tag, "data-src"),
    extractAttribute(tag, "data-lazy-src"),
    extractAttribute(tag, "data-original"),
    extractAttribute(tag, "src"),
  ];

  return candidates.find((value) => value && !value.startsWith("data:image/svg+xml")) ?? "";
}

function replaceImageTagSrc(tag: string, src: string): string {
  if (/\bsrc=["'][^"']+["']/i.test(tag)) {
    return tag.replace(/\bsrc=["'][^"']+["']/i, `src="${src}"`);
  }

  return tag.replace(/<img\b/i, `<img src="${src}"`);
}

function getImageExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
    return normalizeImageExtension(extension);
  } catch {
    return "";
  }
}

function normalizeImageExtension(extension: string): string {
  return extension.replace(/[^a-z0-9]/gi, "").replace(/^jpeg$/i, "jpg").toLowerCase();
}

export function slugify(input: string): string {
  return input
    .replace(/https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}