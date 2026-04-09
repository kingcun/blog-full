import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { timeago } from "../utils/timeago";
import { HashTag } from "./hashtag";
import { useEffect, useRef } from "react";
import { drawBlurhashToCanvas } from "../utils/blurhash";
import { parseImageUrlMetadata } from "../utils/image-upload";
import { useImageLoadState } from "../utils/use-image-load-state";
import { type PostCardVariant, normalizePostCardVariant } from "./post-card-options";
import { useSiteConfig } from "../hooks/useSiteConfig";

function stripHtml(html: string): string {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return (doc.body.textContent || "").trim();
    } catch {
        return html.replace(/<[^>]*>?/gm, "").trim();
    }
}

function FeedCardImage({ src, variant }: { src: string; variant: PostCardVariant }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { src: cleanSrc, blurhash, width, height } = parseImageUrlMetadata(src);
    const { failed, imageRef, loaded, onError, onLoad } = useImageLoadState(cleanSrc);
    const aspectRatio = width && height ? `${width} / ${height}` : undefined;
    const imageFrameClass =
        variant === "editorial"
            ? "relative flex max-h-80 w-full flex-row items-center overflow-hidden"
            : variant === "codelist"
                ? "relative flex h-48 w-full flex-row items-center overflow-hidden bg-neutral-100 dark:bg-neutral-800"
                : "relative mb-2 flex max-h-80 w-full flex-row items-center overflow-hidden";

    useEffect(() => {
        if (!blurhash || !canvasRef.current) {
            return;
        }
        try {
            drawBlurhashToCanvas(canvasRef.current, blurhash);
        } catch (error) {
            console.error("Failed to render blurhash", error);
        }
    }, [blurhash]);

    return (
        <div
            className={imageFrameClass}
            style={{ aspectRatio }}
        >
            {blurhash && !loaded ? (
                <canvas
                    ref={canvasRef}
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full scale-110 object-cover blur-sm"
                />
            ) : null}
            <img
                ref={imageRef}
                src={cleanSrc}
                alt=""
                width={width}
                height={height}
                onLoad={onLoad}
                onError={onError}
                className={`absolute inset-0 h-full w-full object-cover object-center hover:scale-105 translation duration-300 ${blurhash && (!loaded || failed) ? "opacity-0" : "opacity-100"
                    }`}
            />
        </div>
    );
}

const POST_CARD_STYLES: Record<
    PostCardVariant,
    {
        card: string;
        imageWrap: string;
        meta: string;
        summary: string;
        title: string;
    }
> = {
    default: {
        card: "my-2 inline-block w-full break-inside-avoid bg-white p-6 duration-300 dark:bg-neutral-900",
        imageWrap: "",
        meta: "text-gray-400 text-sm",
        summary: "line-clamp-4 text-pretty overflow-hidden dark:text-neutral-500",
        title: "text-xl font-bold text-gray-700 dark:text-white text-pretty overflow-hidden",
    },
    editorial: {
        card: "my-3 inline-block w-full break-inside-avoid overflow-hidden border border-black/10 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.08)] transition-all hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-neutral-900",
        imageWrap: "mb-3 overflow-hidden border border-black/5 dark:border-white/10",
        meta: "text-[12px] font-medium uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400",
        summary: "line-clamp-5 text-pretty text-[15px] leading-7 text-neutral-600 dark:text-neutral-300",
        title: "text-2xl font-semibold tracking-[-0.02em] text-neutral-900 dark:text-white text-pretty overflow-hidden",
    },
    codelist: {
        card: "inline-block w-full break-inside-avoid overflow-hidden bg-white dark:bg-neutral-950",
        imageWrap: "overflow-hidden",
        meta: "text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400",
        summary: "line-clamp-3 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300",
        title: "text-[16px] font-semibold leading-snug text-neutral-900 dark:text-white",
    },
};

export type PostCardProps = {
    id: string;
    avatar?: string;
    draft?: number;
    listed?: number;
    top?: number;
    title: string;
    summary: string;
    hashtags: { id: number, name: string }[];
    createdAt: Date;
    updatedAt: Date;
    views?: number;
    comments?: number;
    preview?: boolean;
    variant?: PostCardVariant;
};

export function PostCard({ id, title, avatar, draft, listed, top, summary, hashtags, createdAt, updatedAt, preview = false, variant }: PostCardProps) {
    const { t } = useTranslation();
    const siteConfig = useSiteConfig();
    const activeVariant = normalizePostCardVariant(variant ?? siteConfig.postCardVariant);
    const styles = POST_CARD_STYLES[activeVariant];
    const avatarSrc = avatar || "/avatar.png";
    const primaryTag = hashtags?.[0]?.name;
    const publishedDate =
        activeVariant === "codelist"
            ? new Date(createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "2-digit",
                year: "numeric",
            })
            : null;
    const body = (
        <div
            className={`${styles.card} ${activeVariant === "codelist" ? "transition-opacity hover:opacity-95" : ""}`}
        >
            <div className={styles.imageWrap}>
                <FeedCardImage src={avatarSrc} variant={activeVariant} />
            </div>

            <div
                className={
                    activeVariant === "editorial" ? "px-2 pb-2" : activeVariant === "codelist"
                            ? "py-2"
                            : ""
                }
            >
                {activeVariant === "codelist" ? (
                    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${styles.meta}`}>
                        {primaryTag ? (
                            <span className="rounded-sm bg-neutral-900 px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-white dark:bg-white dark:text-neutral-900">
                                {primaryTag}
                            </span>
                        ) : null}
                        <span title={new Date(createdAt).toLocaleString()}>{publishedDate}</span>
                    </div>
                ) : (
                    <p className={`space-x-2 ${styles.meta}`}>
                        <span title={new Date(createdAt).toLocaleString()}>
                            {createdAt === updatedAt
                                ? timeago(createdAt)
                                : t("post_card.published$time", { time: timeago(createdAt) })}
                        </span>
                        {createdAt !== updatedAt ? (
                            <span title={new Date(updatedAt).toLocaleString()}>
                                {t("post_card.updated$time", { time: timeago(updatedAt) })}
                            </span>
                        ) : null}
                    </p>
                )}

                <h1 className={`${styles.title} ${activeVariant === "codelist" ? "mt-2" : ""}`}>{title}</h1>

                <p
                    className={`space-x-2 ${styles.meta} ${activeVariant === "editorial" ? "mt-2" : activeVariant === "codelist" ? "mt-2" : ""}`}
                >
                    {draft === 1 ? <span>{t("draft")}</span> : null}
                    {listed === 0 ? <span>{t("unlisted")}</span> : null}
                    {top === 1 ? <span className="text-theme">{t("article.top.title")}</span> : null}
                </p>

                <p className={`${styles.summary} ${activeVariant === "editorial" ? "mt-4 max-w-3xl" : activeVariant === "codelist" ? "mt-2" : ""}`}>
                    {stripHtml(summary)}
                </p>

                {activeVariant !== "codelist" && hashtags.length > 0 ? (
                    <div
                        className={`flex flex-row flex-wrap justify-start gap-2 ${activeVariant === "editorial" ? "mt-4" : "mt-2 gap-x-2"}`}
                    >
                        {hashtags.map(({ name }, index) => (
                            <HashTag key={index} name={name} />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );

    return preview ? body : <Link href={`/post/${id}`} target="_blank" className="block w-full">{body}</Link>;
}
