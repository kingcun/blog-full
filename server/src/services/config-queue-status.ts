import { eq, desc, ne } from "drizzle-orm";
import { posts } from "../db/schema";
import { clearPostCache } from "./post";
import { syncPostAISummaryQueueState } from "./post-ai-summary";

type QueueTaskStatus = "idle" | "pending" | "processing" | "completed" | "failed";

export interface QueueTaskSummary {
  idle: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface QueueTaskItem {
  id: number;
  title: string | null;
  aiSummaryStatus: QueueTaskStatus;
  aiSummaryError: string;
  updatedAt: string;
  createdAt: string;
}

export interface QueueStatusResponse {
  queueConfigured: boolean;
  generatedAt: string;
  summary: QueueTaskSummary;
  items: QueueTaskItem[];
}

export async function retryQueueStatusTask(
  db: any,
  cache: any,
  serverConfig: { get(key: string): Promise<unknown> },
  env: Env,
  postId: number,
) {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });

  if (!post) {
    throw new Error("Post not found");
  }

  if (post.ai_summary_status !== "failed") {
    throw new Error("Only failed AI summary tasks can be retried");
  }

  await syncPostAISummaryQueueState(db, serverConfig, env, postId, {
    draft: post.draft === 1,
    updatedAt: post.updatedAt,
    resetSummary: false,
  });
  await clearPostCache(cache, post.id, post.alias, post.alias);
}

export async function deleteQueueStatusTask(
  db: any,
  cache: any,
  postId: number,
) {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });

  if (!post) {
    throw new Error("Post not found");
  }

  if (post.ai_summary_status !== "failed" && post.ai_summary_status !== "completed") {
    throw new Error("Only failed or completed AI summary task records can be deleted");
  }

  await db
    .update(posts)
    .set({
      ai_summary_status: "idle",
      ai_summary_error: "",
    })
    .where(eq(posts.id, postId));

  await clearPostCache(cache, post.id, post.alias, post.alias);
}

export async function buildQueueStatusResponse(
  db: any,
  env: Env,
): Promise<QueueStatusResponse> {
  const summary: QueueTaskSummary = {
    idle: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  const allPosts = await db.query.posts.findMany({
    columns: {
      id: true,
      ai_summary_status: true,
    },
  });

  for (const post of allPosts) {
    const status = post.ai_summary_status as QueueTaskStatus;
    if (status in summary) {
      summary[status] += 1;
    }
  }

  const items = await db.query.posts.findMany({
    where: ne(posts.ai_summary_status, "idle"),
    columns: {
      id: true,
      title: true,
      ai_summary_status: true,
      ai_summary_error: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: [desc(posts.updatedAt)],
    limit: 50,
  });

  return {
    queueConfigured: Boolean(env.TASK_QUEUE),
    generatedAt: new Date().toISOString(),
    summary,
    items: items.map((item: {
      id: number;
      title: string | null;
      ai_summary_status: string;
      ai_summary_error: string;
      updatedAt: Date;
      createdAt: Date;
    }) => ({
      id: item.id,
      title: item.title,
      aiSummaryStatus: item.ai_summary_status as QueueTaskStatus,
      aiSummaryError: item.ai_summary_error,
      updatedAt: item.updatedAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
  };
}
