export const _POST_AI_SUMMARY_TASK = "post.ai-summary.generate" as const;

export type PostAISummaryStatus =
  | "idle"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface PostAISummaryTaskPayload {
  postId: number;
  expectedUpdatedAt?: string;
  expectedUpdatedAtUnix?: number;
}

export interface PostAISummaryTask {
  type: typeof _POST_AI_SUMMARY_TASK;
  payload: PostAISummaryTaskPayload;
}

export type QueueTask = PostAISummaryTask;

export function createPostAISummaryTask(
  payload: PostAISummaryTaskPayload,
): PostAISummaryTask {
  return {
    type: _POST_AI_SUMMARY_TASK,
    payload,
  };
}

export function isQueueTask(value: unknown): value is QueueTask {
  if (!value || typeof value !== "object") {
    return false;
  }

  const task = value as Partial<QueueTask>;
  if (task.type !== _POST_AI_SUMMARY_TASK) {
    return false;
  }

  const payload = task.payload as Partial<PostAISummaryTaskPayload> | undefined;
  return (
    Boolean(payload) &&
    typeof payload?.postId === "number" &&
    (
      typeof payload?.expectedUpdatedAtUnix === "number" ||
      typeof payload?.expectedUpdatedAt === "string"
    )
  );
}
