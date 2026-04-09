import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { Link, useSearch } from "wouter";
import { PostCard } from "../components/post_card";
import { Waiting } from "../components/loading";
import { client } from "../app/runtime";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";
import { tryInt } from "../utils/int";
import { useTranslation } from "react-i18next";
import { TrendingSidebar } from "../components/trending-sidebar";

type PostsData = {
  size: number;
  data: any[];
  hasNext: boolean;
};

type PostType = "draft" | "unlisted" | "normal";

type PostsMap = {
  [key in PostType]: PostsData;
};

export function PostsPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const query = new URLSearchParams(useSearch());
  const [listState, _setListState] = useState<PostType>(
    (query.get("type") as PostType) || "normal",
  );
  const [status, setStatus] = useState<"loading" | "idle">("idle");
  const [posts, setPosts] = useState<PostsMap>({
    draft: { size: 0, data: [], hasNext: false },
    unlisted: { size: 0, data: [], hasNext: false },
    normal: { size: 0, data: [], hasNext: false },
  });
  const page = tryInt(1, query.get("page"));
  const limit = tryInt(siteConfig.pageSize, query.get("limit"));
  const postListClass =
    siteConfig.postLayout === "masonry"
      ? "wauto columns-1 gap-5 ani-show md:columns-2"
      : "wauto flex flex-col ani-show";
  const latestGridClass = "grid grid-cols-1 gap-6 md:grid-cols-2";
  const paginationClass = "ani-show mt-4 flex flex-row items-center";
  const ref = useRef("");

  function fetchPosts(type: PostType) {
    client.post
      .list({
        page,
        limit,
        type,
      })
      .then(({ data }) => {
        if (data) {
          setPosts((prev) => ({
            ...prev,
            [type]: data,
          }));
          setStatus("idle");
        }
      });
  }

  useEffect(() => {
    const key = `${query.get("page")} ${query.get("type")} ${limit}`;
    if (ref.current === key) return;
    const type = (query.get("type") as PostType) || "normal";
    if (type !== listState) {
      _setListState(type);
    }
    setStatus("loading");
    fetchPosts(type);
    ref.current = key;
  }, [limit, query.get("page"), query.get("type")]);

  const currentList = posts[listState]?.data ?? [];

  const highlightedPosts =
    listState === "normal"
      ? (() => {
          const tops = currentList.filter((post: any) => post.top === 1);
          if (tops.length > 0) return tops;
          return currentList.slice(0, 5);
        })()
      : [];

  const highlightedIds = new Set(
    highlightedPosts.map((post: any) => String(post.id)),
  );

  const visiblePosts =
    listState === "normal"
      ? currentList.filter((post: any) => !highlightedIds.has(String(post.id)))
      : currentList;

  // For "Bài viết mới" section: if the list is too short and all items are consumed
  // by Newsflash, fallback to showing the whole list to avoid rendering an empty block.
  const latestPosts =
    listState === "normal"
      ? (visiblePosts.length > 0 ? visiblePosts : currentList).slice(0, 6)
      : visiblePosts.slice(0, 6);

  return (
    <>
      <Helmet>
        <title>{`${t("article.title")} - ${siteConfig.name}`}</title>
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={t("article.title")} />
        <meta property="og:image" content={siteConfig.avatar} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={document.URL} />
      </Helmet>
      <Waiting
        for={
          posts.draft.size + posts.normal.size + posts.unlisted.size > 0 ||
          status === "idle"
        }
      >
        <main className="w-full bg-white pb-10 pt-6 dark:bg-neutral-950">
          {listState === "normal" && highlightedPosts.length > 0 ? (
            <section className="mx-auto mb-8 grid w-full max-w-[1200px] grid-cols-1 gap-8 px-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex flex-col gap-6">
                <div className="flex items-end justify-between px-1">
                  <div>
                    <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
                      {t("posts.recently_added_files")}
                    </p>
                    <div className="mt-2 h-px w-full bg-neutral-200 dark:bg-neutral-800" />
                  </div>
                </div>

                <Waiting for={status === "idle"}>
                  <div className={latestGridClass}>
                    {latestPosts.map(({ id, ...post }: any) => (
                      <PostCard key={id} id={id} {...post} variant="codelist" />
                    ))}
                  </div>
                  <div className={paginationClass}>
                    {page > 1 && (
                      <Link
                        href={`/?type=${listState}&page=${page - 1}`}
                        className="rounded-full bg-theme px-4 py-2 text-sm font-normal text-white"
                      >
                        {t("previous")}
                      </Link>
                    )}
                    <div className="flex-1" />
                    {posts[listState]?.hasNext && (
                      <Link
                        href={`/?type=${listState}&page=${page + 1}`}
                        className="rounded-full bg-theme px-4 py-2 text-sm font-normal text-white"
                      >
                        {t("next")}
                      </Link>
                    )}
                  </div>
                </Waiting>
              </div>

              <aside className="bg-white p-0 dark:bg-neutral-950">
                <TrendingSidebar />
              </aside>
            </section>
          ) : (
            <Waiting for={status === "idle"}>
              <div className={postListClass}>
                {visiblePosts.map(({ id, ...post }: any) => (
                  <PostCard key={id} id={id} {...post} variant="codelist" />
                ))}
              </div>
              <div className="wauto ani-show mt-4 flex flex-row items-center">
                {page > 1 && (
                  <Link
                    href={`/?type=${listState}&page=${page - 1}`}
                    className="rounded-full bg-theme px-4 py-2 text-sm font-normal text-white"
                  >
                    {t("previous")}
                  </Link>
                )}
                <div className="flex-1" />
                {posts[listState]?.hasNext && (
                  <Link
                    href={`/?type=${listState}&page=${page + 1}`}
                    className="rounded-full bg-theme px-4 py-2 text-sm font-normal text-white"
                  >
                    {t("next")}
                  </Link>
                )}
              </div>
            </Waiting>
          )}
        </main>
      </Waiting>
    </>
  );
}