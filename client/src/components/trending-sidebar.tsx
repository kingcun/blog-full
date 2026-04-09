import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { client } from "../app/runtime";
import { timeago } from "../utils/timeago";
import { parseImageUrlMetadata } from "../utils/image-upload";

const CACHE_KEY = "trending_sidebar_cache";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 giờ

interface TrendingItem {
  id: number;
  title: string;
  avatar?: string;
  createdAt: string;
}

function loadFromCache(): TrendingItem[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveToCache(data: TrendingItem[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

export function clearTrendingCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}

export function TrendingSidebar() {
  const { t } = useTranslation();
  const [list, setList] = useState<TrendingItem[]>([]);
  const cleanAvatar = (src?: string) =>
    parseImageUrlMetadata(src || "/avatar.png").src;

  useEffect(() => {
    const cached = loadFromCache();
    if (cached) {
      setList(cached);
      return;
    }
    client.post.list({ page: 1, limit: 6, type: "normal" }).then(({ data }) => {
      if (data) {
        const items = (data as any).data ?? [];
        setList(items);
        saveToCache(items);
      }
    });
  }, []);

  return (
    <aside className="p-0">
      <div className="flex items-center gap-2 mb-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="text-neutral-900 dark:text-white">
          <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="text-[12px] font-bold uppercase tracking-[0.16em] text-neutral-800 dark:text-neutral-100">
          {t("posts.trending_now")}
        </h2>
      </div>
      <div className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {list.map(({ id, title, avatar, createdAt }) => (
          <Link
            key={id}
            href={`/post/${id}`}
            className="flex gap-3 py-3 transition-opacity hover:opacity-90"
          >
            <div className="h-11 w-[72px] flex-shrink-0 overflow-hidden bg-neutral-100 dark:bg-neutral-800">
              <img
                src={cleanAvatar(avatar)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
                {title}
              </p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                {timeago(createdAt)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </aside>
  );
}