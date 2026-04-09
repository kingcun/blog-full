import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "@rin/ui";
import { useState } from "react";
import { Helmet } from "react-helmet";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { useAlert } from "../components/dialog";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { headersWithAuth } from "../utils/auth";

interface FeedItem {
  title: string;
  link: string;
  description: string;
  contentHtml: string;
  pubDate: string;
  guid: string;
  categories: string[];
}

const PRESET_FEEDS = [
  {
    category: "🔥 Tech Blogs",
    feeds: [
      { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
      { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
      { name: "WIRED", url: "https://www.wired.com/feed/rss" },
      { name: "Engadget", url: "https://www.engadget.com/rss.xml" },
    ],
  },
  {
    category: "🛠️ How-To / Tips",
    feeds: [
      { name: "MakeUseOf", url: "https://www.makeuseof.com/feed/" },
      { name: "Lifehacker", url: "https://lifehacker.com/rss" },
      { name: "How-To Geek", url: "https://www.howtogeek.com/feed/" },
    ],
  },
  {
    category: "🚀 Dev / Coding",
    feeds: [
      { name: "DEV Community", url: "https://dev.to/feed" },
      { name: "Hacker News", url: "https://hnrss.org/frontpage" },
      { name: "Hackernoon", url: "https://hackernoon.com/feed" },
    ],
  },
  {
    category: "📈 SEO / Growth",
    feeds: [
      { name: "Ahrefs Blog", url: "https://ahrefs.com/blog/feed/" },
      { name: "Moz Blog", url: "https://moz.com/blog/feed" },
      { name: "Search Engine Journal", url: "https://www.searchenginejournal.com/feed/" },
    ],
  },
  {
    category: "🧠 AI / SaaS",
    feeds: [
      { name: "Null PHP Script", url: "https://nullphpscript.com/feed/" },
    ],
  },
];

// ── XML helpers ──────────────────────────────────────────────────────────────
function extractCdataBlock(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? "";
}

function extractTagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? "";
}

function extractAllTagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`, "gi");
  const results: string[] = [];
  for (const m of xml.matchAll(re)) {
    const v = (m[1] || m[2] || "").trim();
    if (v) results.push(v);
  }
  return results;
}

function parseFeedXml(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;

  for (const m of xml.matchAll(itemRe)) {
    const block = m[1];

    const title = decodeEntities(
      extractCdataBlock(block, "title") || extractTagText(block, "title")
    );

    let link = extractCdataBlock(block, "link") || extractTagText(block, "link");
    if (!link) {
      const after = block.match(/<link\s*\/?>\s*([^\s<][^<]*)/i);
      link = after?.[1]?.trim() ?? "";
    }
    if (!link) link = extractCdataBlock(block, "guid") || extractTagText(block, "guid");

    const description =
      extractCdataBlock(block, "description") || extractTagText(block, "description");
    const contentHtml =
      extractCdataBlock(block, "content:encoded") || description;
    const pubDate = extractTagText(block, "pubDate") || extractTagText(block, "dc:date");
    const guid = extractCdataBlock(block, "guid") || extractTagText(block, "guid") || link;
    const categories = extractAllTagValues(block, "category");

    items.push({
      title,
      link,
      description: stripHtml(description).slice(0, 200),
      contentHtml,
      pubDate,
      guid,
      categories,
    });
  }

  if (items.length > 0) return items;

  // Atom <entry>
  for (const m of xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = m[1];
    const title = decodeEntities(
      extractCdataBlock(block, "title") || extractTagText(block, "title")
    );
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
    const link = linkMatch?.[1] || extractTagText(block, "link") || "";
    const summary =
      extractCdataBlock(block, "summary") ||
      extractTagText(block, "summary") ||
      extractCdataBlock(block, "content") ||
      extractTagText(block, "content");
    const contentHtml =
      extractCdataBlock(block, "content") || extractTagText(block, "content") || summary;
    const pubDate =
      extractTagText(block, "published") || extractTagText(block, "updated") || "";
    const guid = extractTagText(block, "id") || link;
    const categories = extractAllTagValues(block, "category");

    items.push({
      title,
      link,
      description: stripHtml(summary).slice(0, 200),
      contentHtml,
      pubDate,
      guid,
      categories,
    });
  }

  return items;
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

function stripHtml(html: string): string {
  try {
    return new DOMParser().parseFromString(html, "text/html").body.textContent
      ?.replace(/\s+/g, " ").trim() ?? "";
  } catch {
    return html.replace(/<[^>]+>/g, " ").trim();
  }
}

// ── Sanitize HTML ────────────────────────────────────────────────────────────
function sanitizeHtml(html: string): string {
  if (!html) return "";
  let cleanHtml = html.replace(/\(adsbygoogle=window\.adsbygoogle\|\|\[\]\)\.push\(\{\}\);?/g, "");
  cleanHtml = cleanHtml.replace(/Share (Facebook|X|LinkedIn|Messenger|WhatsApp|Telegram|Email|Print)[^<]*<br\s*\/?>/gi, "");

  const doc = new DOMParser().parseFromString(cleanHtml, "text/html");
  const allowed = new Set([
    "h2","h3","h4","h5","h6","p","br","hr",
    "strong","b","em","i","u","mark","s","del",
    "ul","ol","li","blockquote","pre","code",
    "a","img","figure","figcaption",
    "table","thead","tbody","tr","th","td",
  ]);

  doc.querySelectorAll('h1').forEach((el) => el.remove());

  const removeUnwanted = (root: HTMLElement) => {
    const badSelector = [
      'script', 'style', 'ins',
      '[class*="ads"]', '[id*="ads"]', '[class*="ad-" i]', '[id*="ad-" i]',
      '[class*="share"]', '[id*="share"]', '[class*="social"]', '[id*="social"]',
      '[class*="google"]', '[id*="google"]',
      '[class*="last-updated"]',
      '.post-cat-wrap',
    ].join(',');
    root.querySelectorAll(badSelector).forEach((el) => el.remove());

    root.querySelectorAll('p').forEach((p) => {
      const onlyLinks = Array.from(p.childNodes).every(
        (n) => n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName.toLowerCase() === 'a'
      );
      const allCategoryLinks = onlyLinks && Array.from(p.children).length > 0 && Array.from(p.children).every(
        (a) => a.tagName.toLowerCase() === 'a' && a.getAttribute('href')?.includes('/categories/')
      );
      const isLastUpdated = p.textContent?.trim().startsWith('Last Updated:');
      if (allCategoryLinks || isLastUpdated) p.remove();
    });

    root.querySelectorAll('span.meta-item').forEach((el) => {
      if (el.textContent?.trim().startsWith('Last Updated')) el.remove();
    });
  };
  removeUnwanted(doc.body);

  const walk = (node: Node) => {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (!allowed.has(tag)) {
        while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
        el.remove();
      } else {
        for (const attr of Array.from(el.attributes)) {
          if (!["href","src","alt","title"].includes(attr.name.toLowerCase()))
            el.removeAttribute(attr.name);
        }
        if (tag === "a" && el.getAttribute("href")) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
        walk(el);
      }
    }
  };
  walk(doc.body);

  doc.body.querySelectorAll('p, li').forEach((el) => {
    const links = Array.from(el.querySelectorAll('a'));
    const textOutsideLinks = (el.textContent || '').replace(
      links.map((a) => a.textContent || '').join(''), ''
    ).trim();
    const allCatLinks = links.length > 0 &&
      links.every((a) => (a.getAttribute('href') || '').includes('/categories/')) &&
      textOutsideLinks === '';
    if (allCatLinks) el.remove();
  });

  const walkTextNodes = (node: Node) => {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        if ((child.textContent || '').includes('Last Updated')) child.remove();
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if ((el.textContent || '').includes('Last Updated') &&
            el.querySelectorAll('*').length === 0) {
          el.remove();
        } else {
          walkTextNodes(child);
        }
      }
    }
  };
  walkTextNodes(doc.body);

  return doc.body.innerHTML.trim();
}

// ── Lookup tables (dùng chung) ───────────────────────────────────────────────
const KNOWN_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

const EXT_TO_MIME: Record<string, string> = {
  "jpg": "image/jpeg",
  "jpeg": "image/jpeg",
  "png": "image/png",
  "gif": "image/gif",
  "webp": "image/webp",
  "avif": "image/avif",
};

// ── Upload ảnh lên R2 ────────────────────────────────────────────────────────
async function reuploadImagesToR2(html: string): Promise<string> {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img"));

  await Promise.all(
    imgs.map(async (img) => {
      // Prioritize data-src (lazy loading) over src
      const src = img.getAttribute("data-src") || img.getAttribute("src");
      if (!src || src.startsWith("data:") || src.startsWith("/")) return;

      try {
        // Parse URL to extract extension
        let urlExt = "";
        let nameWithoutExt = "image";
        try {
          const urlPath = new URL(src).pathname;
          const base = urlPath.split("/").pop()?.split("?")[0] || "";
          const dotIdx = base.lastIndexOf(".");
          if (dotIdx !== -1) {
            urlExt = base.slice(dotIdx + 1).toLowerCase();
            nameWithoutExt = base.slice(0, dotIdx);
          }
        } catch (e) {
          console.warn(`Failed to parse URL: ${src}`, e);
        }

        // Skip SVG images
        if (urlExt === "svg" || src.includes(".svg")) return;

        // Fetch image via proxy
        const res = await fetch(`/api/fetch-feed?url=${encodeURIComponent(src)}`, {
          headers: headersWithAuth(),
        });

        if (!res.ok) return;

        const blob = await res.blob();
        if (blob.size === 0) return;

        // Validate image type
        const rawMimeExt = MIME_TO_EXT[blob.type] ?? "";
        const isImageByMime = blob.type.startsWith("image/");
        const isImageByExt = KNOWN_IMAGE_EXTS.has(urlExt);

        if (!isImageByMime && !isImageByExt) return;

        // Select final extension (prioritize URL ext > MIME ext > jpg)
        let finalExt = KNOWN_IMAGE_EXTS.has(urlExt) ? urlExt : (rawMimeExt || "jpg");
        finalExt = finalExt.replace(/\+[a-z]+$/i, "").replace(/[^a-z0-9]/gi, "") || "jpg";

        const finalMime = EXT_TO_MIME[finalExt] ?? (isImageByMime ? blob.type : "image/jpeg");
        const fname = `${nameWithoutExt || "image"}.${finalExt}`;

        // Upload to R2
        const correctedBlob = new Blob([blob], { type: finalMime });
        const file = new File([correctedBlob], fname, { type: finalMime });

        const form = new FormData();
        form.append("key", fname);
        form.append("file", file);

        const up = await fetch("/api/storage", {
          method: "POST",
          body: form,
          headers: headersWithAuth(),
        });

        if (!up.ok) {
          console.warn(`Upload failed: ${up.status}`);
          return;
        }

        const upJson = await up.json() as { url?: string };
        if (upJson.url) img.setAttribute("src", upJson.url);
      } catch (e) {
        console.error("Image processing error:", e);
      }
    })
  );

  return doc.body.innerHTML;
}

// Trích xuất link download từ các block download-link-section
function extractDownloadLinks(html: string): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links: string[] = [];
  doc.querySelectorAll('.download-link-section input[type="text"]').forEach((input) => {
    const val = (input as HTMLInputElement).value;
    if (val && /^https?:\/\//.test(val)) links.push(val);
  });
  return links;
}

// ── HTML → Markdown ──────────────────────────────────────────────────────────
function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  function w(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    const el = node as Element;
    const tag = el.tagName?.toLowerCase() ?? "";
    const ch = Array.from(node.childNodes).map(w).join("");

    switch (tag) {
      case "h1": return `\n# ${ch.trim()}\n`;
      case "h2": return `\n## ${ch.trim()}\n`;
      case "h3": return `\n### ${ch.trim()}\n`;
      case "h4": return `\n#### ${ch.trim()}\n`;
      case "h5": return `\n##### ${ch.trim()}\n`;
      case "h6": return `\n###### ${ch.trim()}\n`;
      case "p": return `\n${ch.trim()}\n`;
      case "br": return "\n";
      case "hr": return "\n---\n";
      case "strong": case "b": return `**${ch}**`;
      case "em": case "i": return `*${ch}*`;
      case "s": case "del": return `~~${ch}~~`;
      case "code": return el.closest("pre") ? ch : `\`${ch}\``;
      case "pre": return `\n\`\`\`\n${el.textContent ?? ""}\n\`\`\`\n`;
      case "blockquote": return `\n> ${ch.trim().replace(/\n/g, "\n> ")}\n`;
      case "a": {
        const href = el.getAttribute("href") || "#";
        return `[${ch}](${href})`;
      }
      case "img": {
        const src = el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        return src ? `\n![${alt}](${src})\n` : "";
      }
      case "ul": {
        const lis = Array.from(el.querySelectorAll(":scope > li"))
          .map((li) => `- ${w(li).trim()}`).join("\n");
        return `\n${lis}\n`;
      }
      case "ol": {
        const lis = Array.from(el.querySelectorAll(":scope > li"))
          .map((li, i) => `${i + 1}. ${w(li).trim()}`).join("\n");
        return `\n${lis}\n`;
      }
      case "li": return ch;
      case "figure": return ch;
      case "figcaption": return `\n*${ch.trim()}*\n`;
      case "tr": {
        const cells = Array.from(el.querySelectorAll("th,td"))
          .map((c) => w(c).trim()).join(" | ");
        return `| ${cells} |\n`;
      }
      case "thead": {
        const cols = el.querySelectorAll("th,td").length;
        return ch + `| ${Array(cols).fill("---").join(" | ")} |\n`;
      }
      default: return ch;
    }
  }

  return w(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}

// ── Component ────────────────────────────────────────────────────────────────
export function ImportArticlePage() {
  const siteConfig = useSiteConfig();
  const [feedUrl, setFeedUrl] = useState("https://nullphpscript.com/feed/");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [showPresets, setShowPresets] = useState(false);
  const { showAlert, AlertUI } = useAlert();

  const fetchFeed = async () => {
    if (!feedUrl.trim()) { showAlert("Please enter a feed URL"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/fetch-feed?url=${encodeURIComponent(feedUrl)}`, {
        headers: headersWithAuth(),
      });
      if (!res.ok) { showAlert(`Failed to fetch: ${res.status} ${res.statusText}`); return; }
      const xml = await res.text();
      const parsed = parseFeedXml(xml);
      if (!parsed.length) { showAlert("No articles found in feed"); return; }
      setItems(parsed);
      setSelected(new Set());
      showAlert(`Found ${parsed.length} articles`);
    } catch (e) {
      showAlert(e instanceof Error ? e.message : "Failed to fetch feed");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (guid: string) => {
    const s = new Set(selected);
    s.has(guid) ? s.delete(guid) : s.add(guid);
    setSelected(s);
  };

  const toggleAll = () =>
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.guid)));

  const importSelected = async () => {
    if (!selected.size) { showAlert("Please select articles to import"); return; }
    setImporting(true);
    const list = items.filter((i) => selected.has(i.guid));
    setProgress({ current: 0, total: list.length });
    let ok = 0, fail = 0;

    for (const item of list) {
      try {
        let rawHtml = item.contentHtml || item.description;
        if (item.link) {
          try {
            const pageRes = await fetch(`/api/fetch-feed?url=${encodeURIComponent(item.link)}`, {
              headers: headersWithAuth(),
            });
            if (pageRes.ok) {
              const pageHtml = await pageRes.text();
              const pd = new DOMParser().parseFromString(pageHtml, "text/html");
              const article =
                pd.querySelector("article") ||
                pd.querySelector("[role='main']") ||
                pd.querySelector("main") ||
                pd.querySelector(".post-content") ||
                pd.querySelector(".entry-content");
              if (article?.innerHTML) {
                rawHtml = article.innerHTML;
              }
            }
          } catch (e) {
            console.warn(`Failed to fetch source URL: ${item.link}`, e);
          }
        }

        // Trích xuất link download nếu có
        const downloadLinks = extractDownloadLinks(rawHtml);
        const clean = sanitizeHtml(rawHtml);
        const withR2 = await reuploadImagesToR2(clean);

        // Convert HTML to Markdown
        let markdown = htmlToMarkdown(withR2);
        
        // Add category line
        if (item.categories?.length > 0) {
          markdown = `*${item.categories[0]}*\n\n${markdown}`;
        }

        markdown = markdown.replace(/^(\*?([A-Za-z0-9\s\-]+)\*?)+\n+/g, '');

        if (downloadLinks.length > 0) {
          markdown += '\n\n---\n**Download Links:**\n' + downloadLinks.map((l) => `- [${l}](${l})`).join('\n');
        }

        const summary = stripHtml(item.description || rawHtml).slice(0, 150);

        const { error } = await client.post.create({
          title: item.title || "Untitled",
          content: markdown,
          summary,
          tags: item.categories.slice(0, 5),
          listed: true,
          draft: false,
          createdAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
        });

        if (error) {
          console.error(`Failed to create post: ${item.title}`, error);
          fail++;
        } else {
          ok++;
        }
      } catch (e) {
        console.error(`Import error: ${item.title}`, e);
        fail++;
      }

      setProgress((p) => ({ ...p, current: p.current + 1 }));
    }

    setImporting(false);
    setSelected(new Set());
    showAlert(`Done: ${ok} imported, ${fail} failed`);
  };

  return (
    <>
      <Helmet><title>{`Import Article - ${siteConfig.name}`}</title></Helmet>

      <div className="space-y-6">
        <SettingsCard>
          <SettingsCardHeader
            title="Feed Configuration"
            description="Fetch articles from RSS or Atom feed URL"
          />
          <SettingsCardBody>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Feed URL</label>
                <Input value={feedUrl} setValue={setFeedUrl} placeholder="https://example.com/feed/" variant="flat" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  title={loading ? "Fetching..." : "Fetch Articles"}
                  disabled={loading || !feedUrl.trim()}
                  onClick={fetchFeed}
                />
                <Button
                  title={showPresets ? "Hide Presets" : "Browse Preset Feeds"}
                  onClick={() => setShowPresets((v) => !v)}
                />
              </div>
              {showPresets && (
                <div className="space-y-4 pt-2 border-t border-neutral-200 dark:border-neutral-700">
                  {PRESET_FEEDS.map((group) => (
                    <div key={group.category}>
                      <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{group.category}</p>
                      <div className="flex flex-wrap gap-2">
                        {group.feeds.map((feed) => (
                          <button
                            key={feed.url}
                            onClick={() => { setFeedUrl(feed.url); setShowPresets(false); }}
                            className="px-3 py-1.5 text-sm rounded-md bg-neutral-100 dark:bg-white/10 hover:bg-neutral-200 dark:hover:bg-white/20 transition-colors text-neutral-700 dark:text-neutral-300"
                          >
                            {feed.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsCardBody>
        </SettingsCard>

        {items.length > 0 && (
          <SettingsCard>
            <SettingsCardHeader
              title="Articles"
              description={`${selected.size} of ${items.length} selected`}
            />
            <SettingsCardBody>
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap items-center">
                  <Button
                    title={selected.size === items.length ? "Deselect All" : "Select All"}
                    onClick={toggleAll}
                  />
                  <Button
                    title={importing ? `Importing… (${progress.current}/${progress.total})` : `Import ${selected.size > 0 ? `(${selected.size})` : "Selected"}`}
                    disabled={importing || selected.size === 0}
                    onClick={importSelected}
                  />
                  {importing && (
                    <div className="flex-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                      <div
                        className="h-full bg-theme transition-all duration-300"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="max-h-[500px] overflow-y-auto border border-neutral-200 rounded-lg dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700">
                  {items.map((item) => (
                    <div
                      key={item.guid}
                      className="flex items-start gap-3 p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                      onClick={() => toggle(item.guid)}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.guid)}
                        onChange={() => toggle(item.guid)}
                        className="mt-1 cursor-pointer flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="font-medium line-clamp-2 text-sm">{item.title}</h4>
                        {item.description && (
                          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          {item.pubDate && (
                            <span className="text-xs text-neutral-400">
                              {new Date(item.pubDate).toLocaleDateString()}
                            </span>
                          )}
                          {item.categories.slice(0, 3).map((cat) => (
                            <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-white/10 text-neutral-500 dark:text-neutral-400">
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SettingsCardBody>
          </SettingsCard>
        )}
      </div>
      <AlertUI />
    </>
  );
}