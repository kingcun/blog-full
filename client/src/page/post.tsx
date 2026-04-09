import type { Post } from "@rin/api";
import { useContext, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactModal from "react-modal";
import { Link, useLocation } from "wouter";
import { useAlert, useConfirm } from "../components/dialog";
import { HashTag } from "../components/hashtag";
import { Waiting } from "../components/loading";
import { Markdown } from "../components/markdown";
import { client } from "../app/runtime";
import { ClientConfigContext } from "../state/config";
import { ProfileContext } from "../state/profile";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { timeago } from "../utils/timeago";
import { Button } from "../components/button";
import { Tips } from "../components/tips";
import mermaid from "mermaid";
import { AdjacentSection } from "../components/adjacent_post.tsx";
import { Comments } from "../components/comments";
import { stripImageUrlMetadata } from "../utils/image-upload";
import { TrendingSidebar } from "../components/trending-sidebar";

function extractFirstMarkdownImageUrl(content: string) {
  const match = /!\[.*?\]\((\S+?)(?:\s+"[^"]*")?\)/.exec(content);
  if (!match) {
    return undefined;
  }

  return stripImageUrlMetadata(match[1]);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1") // links → text
    .replace(/#{1,6}\s+/g, "") // headings
    .replace(/[*_~`]/g, "") // bold/italic/code
    .replace(/\n+/g, " ")
    .trim();
}

function ShareButtons({ title }: { title: string }) {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(title);

  const socials = [
    { label: "Facebook", bg: "#1877F2", href: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      icon: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" fill="white"/> },
    { label: "X", bg: "#000", href: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
      icon: <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="white"/> },
    { label: "LinkedIn", bg: "#0A66C2", href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      icon: <><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" fill="white"/><rect x="2" y="9" width="4" height="12" fill="white"/><circle cx="4" cy="4" r="2" fill="white"/></> },
    { label: "Reddit", bg: "#FF4500", href: `https://www.reddit.com/submit?url=${url}&title=${text}`,
      icon: <circle cx="12" cy="12" r="10" fill="white" opacity="0.3"/> },
  ];

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 border border-neutral-200 dark:border-neutral-700 px-4 py-3">
      <span className="flex items-center gap-1.5 text-[13px] text-neutral-500 dark:text-neutral-400 mr-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Share
      </span>
      {socials.map(({ label, bg, href, icon }) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-85"
          style={{ background: bg }}>
          <svg width="14" height="14" viewBox="0 0 24 24">{icon}</svg>
          {label}
        </a>
      ))}
      <button onClick={() => navigator.clipboard?.writeText(window.location.href)}
        className="flex items-center gap-1.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-[12px] font-medium t-primary transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy link
      </button>
      <button onClick={() => window.print()}
        className="flex items-center gap-1.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-[12px] font-medium t-primary transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
        </svg>
        Print
      </button>
    </div>
  );
}

export function PostPage({ id, clean }: { id: string, TOC: () => JSX.Element, clean: (id: string) => void }) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const profile = useContext(ProfileContext);
  const [post, setPost] = useState<Post>();
  const [error, setError] = useState<string>();
  const [headImage, setHeadImage] = useState<string>();
  const ref = useRef("");
  const [, setLocation] = useLocation();
  const { showAlert, AlertUI } = useAlert();
  const { showConfirm, ConfirmUI } = useConfirm();
  const [top, setTop] = useState<number>(0);
  const config = useContext(ClientConfigContext);
  const counterEnabled = config.getBoolean('counter.enabled');
  const hasAISummary = Boolean(post?.ai_summary?.trim());
  const showAISummaryState = post?.ai_summary_status === "pending" || post?.ai_summary_status === "processing" || post?.ai_summary_status === "failed";
  function deletePost() {
    // Confirm
    showConfirm(
      t("article.delete.title"),
      t("article.delete.confirm"),
      () => {
        if (!post) return;
        client.post
          .delete(post.id)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(t("delete.success"));
              setLocation("/");
            }
          });
      })
  }
  function topPost() {
    const isUnTop = !(top > 0)
    const topNew = isUnTop ? 1 : 0;
    // Confirm
    showConfirm(
      isUnTop ? t("article.top.title") : t("article.untop.title"),
      isUnTop ? t("article.top.confirm") : t("article.untop.confirm"),
      () => {
        if (!post) return;
        client.post
          .setTop(post.id, topNew)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(isUnTop ? t("article.top.success") : t("article.untop.success"));
              setTop(topNew);
            }
          });
      })
  }
  useEffect(() => {
    if (ref.current == id) return;
    setPost(undefined);
    setError(undefined);
    setHeadImage(undefined);
    client.post
      .get(id)
      .then(({ data, error }) => {
        if (error) {
          setError(error.value as string);
        } else if (data && typeof data !== "string") {
          setTimeout(() => {
            setPost(data as any);
            setTop(data.top || 0);
            const headImageUrl = extractFirstMarkdownImageUrl(data.content);
            if (headImageUrl) {
              setHeadImage(headImageUrl);
            }
            clean(id);
          }, 0);
        }
      });
    ref.current = id;
  }, [id]);
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
    });
    mermaid.run({
      suppressErrors: true,
      nodes: document.querySelectorAll("pre.mermaid_default")
    }).then(() => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
      });
      mermaid.run({
        suppressErrors: true,
        nodes: document.querySelectorAll("pre.mermaid_dark")
      });
    })
  }, [post]);

  return (
    <Waiting for={post || error}>
      {post && (
        <Helmet>
          <title>{`${post.title ?? "Unnamed"} - ${siteConfig.name}`}</title>
          <link rel="canonical" href={document.URL} />
          <meta name="author" content={post.user.username} />
          <meta
            name="description"
            content={stripMarkdown(post.content).slice(0, 160)}
          />
          <meta
            name="keywords"
            content={post.hashtags.map(({ name }) => name).join(", ")}
          />
          <meta property="og:type" content="article" />
          <meta property="og:site_name" content={siteConfig.name} />
          <meta property="og:title" content={post.title ?? ""} />
          <meta
            property="og:description"
            content={stripMarkdown(post.content).slice(0, 160)}
          />
          <meta property="og:url" content={document.URL} />
          {headImage && <meta property="og:image" content={headImage} />}
          <meta property="og:locale" content="vi_VN" />
          <meta property="article:published_time" content={new Date(post.createdAt).toISOString()} />
          <meta property="article:modified_time" content={new Date(post.updatedAt).toISOString()} />
          {post.hashtags.map(({ name }) => (
            <meta key={name} property="article:tag" content={name} />
          ))}
        </Helmet>
      )}
      <div className="max-w-[1300px] w-full mx-auto flex flex-row ani-show my-4">
        {error && (
          <>
            <div className="flex flex-col wauto rounded-2xl bg-w m-2 p-6 items-center justify-center space-y-2">
              <h1 className="text-xl font-bold t-primary">{error}</h1>
              {error === "Not found" && id === "about" && (
                <Tips value={t("about.notfound")} />
              )}
              <Button
                title={t("index.back")}
                onClick={() => (window.location.href = "/")}
              />
            </div>
          </>
        )}
        {post && !error && (
          <>
            <main className="w-full md:w-2/3">
              <article
                className="overflow-hidden mr-4"
                aria-label={post.title ?? "Unnamed"}
              >
                {/* Meta row: date · updated · counters · admin actions */}
                <div className="flex items-center justify-between gap-2 mt-1 mb-3">
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
                    <span
                      className="flex items-center gap-1 text-[12px] text-gray-400"
                      title={new Date(post.createdAt).toLocaleString()}
                    >
                      <i className="ri-calendar-line text-[11px]" />
                      {t("post_card.published$time", { time: timeago(post.createdAt) })}
                    </span>
                    {post.createdAt !== post.updatedAt && (
                      <span
                        className="flex items-center gap-1 text-[12px] text-gray-400"
                        title={new Date(post.updatedAt).toLocaleString()}
                      >
                        <i className="ri-refresh-line text-[11px]" />
                        {t("post_card.updated$time", { time: timeago(post.updatedAt) })}
                      </span>
                    )}
                    {counterEnabled && (
                      <span className="flex items-center gap-1 text-[12px] text-gray-400">
                        <i className="ri-eye-line text-[11px]" />
                        {t("count.pv")} {post.pv}
                        <span className="mx-1 opacity-40">·</span>
                        <i className="ri-user-line text-[11px]" />
                        {t("count.uv")} {post.uv}
                      </span>
                    )}
                  </div>
                  {profile?.permission && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        aria-label={top > 0 ? t("untop.title") : t("top.title")}
                        onClick={topPost}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition text-sm ${
                          top > 0
                            ? "bg-theme text-white hover:bg-theme-hover active:bg-theme-active"
                            : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        }`}
                      >
                        <i className="ri-skip-up-line" />
                      </button>
                      <Link
                        aria-label={t("edit")}
                        href={`/admin/writing/${post.id}`}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition text-sm"
                      >
                        <i className="ri-edit-2-line" />
                      </Link>
                      <button
                        aria-label={t("delete.title")}
                        onClick={deletePost}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition text-sm"
                      >
                        <i className="ri-delete-bin-7-line text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
                {/* Title */}
                <h1 className="text-2xl font-bold t-primary break-words leading-snug mb-1">
                  {post.title}
                </h1>
                {(hasAISummary || showAISummaryState) && (
                  <div className="my-4 p-4 rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-100 dark:border-purple-800/30">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <i className="ri-sparkling-2-fill text-purple-500" />
                        <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                          {t('ai_summary.title')}
                        </span>
                      </div>
                      {showAISummaryState ? (
                        <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-medium text-purple-700 dark:bg-white/10 dark:text-purple-300">
                          {t(`ai_summary.status.${post.ai_summary_status}`)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm t-secondary leading-relaxed whitespace-pre-wrap">
                      {hasAISummary ? post.ai_summary : t(`ai_summary.message.${post.ai_summary_status}`)}
                    </p>
                    {post.ai_summary_status === "failed" && post.ai_summary_error ? (
                      <p className="mt-2 text-xs text-rose-600 dark:text-rose-300 whitespace-pre-wrap">
                        {post.ai_summary_error}
                      </p>
                    ) : null}
                  </div>
                )}
                <Markdown content={post.content} />
                <div className="mt-6 flex flex-col gap-2">
                  {post.hashtags.length > 0 && (
                    <div className="flex flex-row flex-wrap gap-x-2">
                      {post.hashtags.map(({ name }, index) => (
                        <HashTag key={index} name={name} />
                      ))}
                    </div>
                  )}
                  <div className="flex flex-row items-center gap-2 pt-1">
                    <img
                      src={post.user.avatar || "/avatar.png"}
                      className="w-7 h-7 rounded-full ring-1 ring-neutral-200 dark:ring-neutral-700"
                      alt={post.user.username}
                    />
                    <span className="text-[13px] text-gray-500 dark:text-gray-400 italic">
                      {post.user.username}
                    </span>
                  </div>
                </div>
              </article>
              <ShareButtons title={post.title ?? ""} />
              <AdjacentSection id={id} setError={setError} />
              {post && <Comments id={`${post.id}`} />}
              <div className="h-16" />
            </main>
            <div className="w-full md:w-1/3 hidden lg:block relative px-4">
              <div className="start-0 end-0 top-[5.5rem] sticky">
                <TrendingSidebar />
              </div>
            </div>
          </>
        )}
      </div>
      <AlertUI />
      <ConfirmUI />
    </Waiting>
  );
}

export function TOCHeader({ TOC }: { TOC: () => JSX.Element }) {
  const [isOpened, setIsOpened] = useState(false);

  return (
    <div className="shrink-0 lg:hidden">
      <button
        onClick={() => setIsOpened(true)}
        className="w-10 h-10 rounded-full flex flex-row items-center justify-center"
      >
        <i className="ri-menu-2-line text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 ri-lg md:ri-sm md:t-secondary"></i>
      </button>
      <ReactModal
        isOpen={isOpened}
        style={{
          content: {
            top: "50%",
            left: "50%",
            right: "auto",
            bottom: "auto",
            marginRight: "-50%",
            transform: "translate(-50%, -50%)",
            padding: "0",
            border: "none",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            background: "none",
          },
          overlay: {
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 1000,
          },
        }}
        onRequestClose={() => setIsOpened(false)}
      >
        <div className="w-[80vw] sm:w-[60vw] lg:w-[40vw] overflow-clip relative t-primary">
          <TOC />
        </div>
      </ReactModal>
    </div>
  );
}