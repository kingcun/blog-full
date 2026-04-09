import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import Popup from "reactjs-popup";
import { useAlert, useConfirm } from "./dialog";
import { client } from "../app/runtime";
import { ClientConfigContext } from "../state/config";
import { ProfileContext } from "../state/profile";

type Comment = {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: number;
    username: string;
    avatar: string | null;
    permission: number | null;
  };
};

// ─── CommentItem ────────────────────────────────────────────────────────────

function CommentItem({
  comment,
  onRefresh,
}: {
  comment: Comment;
  onRefresh: () => void;
}) {
  const { showConfirm, ConfirmUI } = useConfirm();
  const { showAlert, AlertUI } = useAlert();
  const { t } = useTranslation();
  const profile = useContext(ProfileContext);

  function deleteComment() {
    showConfirm(
      t("delete.comment.title"),
      t("delete.comment.confirm"),
      async () => {
        client.comment.delete(comment.id).then(({ error }) => {
          if (error) {
            showAlert(error.value as string);
          } else {
            showAlert(t("delete.success"), () => {
              onRefresh();
            });
          }
        });
      }
    );
  }

  return (
    <div className="flex flex-row items-start gap-3 py-4 border-b border-neutral-200 dark:border-neutral-700 last:border-0">
      {/* Avatar */}
      <img
        src={comment.user.avatar || "https://www.gravatar.com/avatar?d=mp&f=y"}
        className="w-10 h-10 rounded-full flex-shrink-0"
        alt={comment.user.username}
      />

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Name + date row */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold t-primary">
            {comment.user.username}
          </span>
          <span
            title={new Date(comment.createdAt).toLocaleString()}
            className="text-xs text-neutral-400 dark:text-neutral-500"
          >
            {new Date(comment.createdAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })}
          </span>

          {/* Delete popup (admin / own comment) */}
          {(profile?.permission || profile?.id === comment.user.id) && (
            <Popup
              arrow={false}
              trigger={
                <button className="ml-auto px-2 py-0.5 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
                  <i className="ri-more-fill text-sm" />
                </button>
              }
              position="left center"
            >
              <div className="flex flex-row self-end mr-2">
                <button
                  onClick={deleteComment}
                  aria-label={t("delete.comment.title")}
                  className="px-2 py bg-secondary rounded-full"
                >
                  <i className="ri-delete-bin-2-line t-secondary" />
                </button>
              </div>
            </Popup>
          )}
        </div>

        {/* Comment text */}
        <p className="t-primary text-sm leading-relaxed break-words">
          {comment.content}
        </p>
      </div>

      <ConfirmUI />
      <AlertUI />
    </div>
  );
}

// ─── CommentInput ────────────────────────────────────────────────────────────

function CommentInput({
  id,
  onRefresh,
}: {
  id: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const { showAlert, AlertUI } = useAlert();
  const profile = useContext(ProfileContext);
  const [, setLocation] = useLocation();

  function errorHumanize(err: string) {
    if (err === "Unauthorized") return t("login.required");
    if (err === "Content is required") return t("comment.empty");
    return err;
  }

  function submit() {
    if (!profile) {
      setLocation("/login");
      return;
    }
    client.comment
      .create(parseInt(id), { content })
      .then(({ error: err }) => {
        if (err) {
          setError(errorHumanize(err.value as string));
        } else {
          setContent("");
          setName("");
          setError("");
          showAlert(t("comment.success"), () => {
            onRefresh();
          });
        }
      });
  }

  return (
    <div className="w-full px-0 py-4">
      {/* Leave a Reply heading */}
      <h3 className="text-base font-bold t-primary mb-1">
        {t("comment.leave_reply", { defaultValue: "Leave a Reply" })}
      </h3>
      <div className="border-b-2 border-theme mb-4 w-10" />

      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
        {t("comment.email_note", {
          defaultValue:
            "Your email address will not be published. Required fields are marked ",
        })}
        <span className="text-red-500">*</span>
      </p>

      {profile ? (
        <>
          {/* Comment textarea */}
          <textarea
            id="comment"
            placeholder={t("comment.placeholder.title", {
              defaultValue: "Say something...",
            })}
            className="
              bg-w border border-neutral-300 dark:border-neutral-600
              w-full h-32 rounded-lg p-3 text-sm t-primary
              focus:outline-none focus:border-theme resize-none
            "
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          {/* Name field */}
          <div className="mt-3 mb-4">
            <label
              htmlFor="comment-name"
              className="block text-sm font-medium t-primary mb-1"
            >
              {t("comment.name", { defaultValue: "Name" })}{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="comment-name"
              type="text"
              className="
                bg-w border border-neutral-300 dark:border-neutral-600
                w-full rounded-lg p-2 text-sm t-primary
                focus:outline-none focus:border-theme
              "
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Submit button */}
          <button
            className="bg-theme text-white text-sm font-medium px-5 py-2 rounded hover:bg-theme-hover active:bg-theme-active transition-colors"
            onClick={submit}
          >
            {t("comment.submit", { defaultValue: "Post Comment" })}
          </button>
        </>
      ) : (
        <div className="flex w-full items-center justify-center py-10">
          <button
            className="bg-theme text-white px-5 py-2 text-sm rounded hover:bg-theme-hover transition-colors"
            onClick={() => setLocation("/login")}
          >
            {t("login.required")}
          </button>
        </div>
      )}

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      <AlertUI />
    </div>
  );
}

// ─── Comments (main export) ──────────────────────────────────────────────────

export function Comments({ id }: { id: string }) {
  const config = useContext(ClientConfigContext);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string>();
  const ref = useRef("");
  const { t } = useTranslation();

  function loadComments() {
    client.comment
      .list(parseInt(id))
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.value as string);
        } else if (data && Array.isArray(data)) {
          setComments(data as any);
        }
      });
  }

  useEffect(() => {
    if (ref.current === id) return;
    loadComments();
    ref.current = id;
  }, [id]);

  if (!config.getBoolean("comment.enabled")) return null;

  return (
    <div className="mx-2 mt-6">
      {/* Comment count heading */}
      {comments.length > 0 && (
        <>
          <h3 className="text-base font-bold t-primary mb-1">
            {comments.length}{" "}
            {t("comment.count", { defaultValue: "Comments" })}
          </h3>
          <div className="border-b-2 border-theme mb-4 w-10" />
        </>
      )}

      {/* Comment list */}
      {error ? (
        <div className="flex flex-col items-center justify-center py-6">
          <p className="text-sm t-primary mb-3">{error}</p>
          <button
            className="bg-theme text-white text-sm px-4 py-2 rounded hover:bg-theme-hover transition-colors"
            onClick={loadComments}
          >
            {t("reload")}
          </button>
        </div>
      ) : (
        comments.length > 0 && (
          <div className="w-full mb-4">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onRefresh={loadComments}
              />
            ))}
          </div>
        )
      )}

      {/* Input form */}
      <CommentInput id={id} onRefresh={loadComments} />
    </div>
  );
}