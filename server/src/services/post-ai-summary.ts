import { eq } from "drizzle-orm";
import { posts } from "../db/schema";
import type { CacheImpl, DB } from "../core/hono-types";
import { createTaskQueue, createPostAISummaryTask, type PostAISummaryStatus } from "../queue";
import { generateAISummaryResult } from "../utils/ai";
import { getAIConfig } from "../utils/db-config";

type ConfigReader = {
  get(key: string): Promise<unknown>;
};

function buildStatusUpdate(
  status: PostAISummaryStatus,
  overrides?: Partial<{
    ai_summary: string;
    ai_summary_status: PostAISummaryStatus;
    ai_summary_error: string;
  }>,
) {
  return {
    ai_summary_status: status,
    ai_summary_error: "",
    ...overrides,
  };
}

export async function enqueuePostAISummary(
  env: Env,
  postId: number,
  updatedAt: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createTaskQueue(env).send(
      createPostAISummaryTask({
        postId,
        expectedUpdatedAtUnix: normalizeQueueUpdatedAt(updatedAt),
      }),
    );

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeQueueUpdatedAt(updatedAt: Date) {
  return Math.floor(updatedAt.getTime() / 1000);
}

export function matchesExpectedUpdatedAt(
  updatedAt: Date,
  payload: {
    expectedUpdatedAt?: string;
    expectedUpdatedAtUnix?: number;
  },
) {
  const actual = normalizeQueueUpdatedAt(updatedAt);

  if (typeof payload.expectedUpdatedAtUnix === "number") {
    return actual === payload.expectedUpdatedAtUnix;
  }

  if (typeof payload.expectedUpdatedAt === "string") {
    const expected = Date.parse(payload.expectedUpdatedAt);
    if (Number.isFinite(expected)) {
      return actual === Math.floor(expected / 1000);
    }
  }

  return false;
}

export async function syncPostAISummaryQueueState(
  db: DB,
  serverConfig: ConfigReader,
  env: Env,
  postId: number,
  options: {
    draft: boolean;
    updatedAt: Date;
    resetSummary?: boolean;
  },
) {
  const aiConfig = await getAIConfig(serverConfig);
  const shouldQueue = aiConfig.enabled && !options.draft;

  if (!shouldQueue) {
    await db
      .update(posts)
      .set(
        buildStatusUpdate("idle", options.resetSummary ? { ai_summary: "" } : undefined),
      )
      .where(eq(posts.id, postId));
    return;
  }

  await db
    .update(posts)
    .set(
      buildStatusUpdate("pending", {
        ai_summary: options.resetSummary ? "" : undefined,
      }),
    )
    .where(eq(posts.id, postId));

  const enqueueResult = await enqueuePostAISummary(env, postId, options.updatedAt);
  if (!enqueueResult.ok) {
    await db
      .update(posts)
      .set(
        buildStatusUpdate("failed", {
          ai_summary_error: enqueueResult.error,
        }),
      )
      .where(eq(posts.id, postId));
  }
}

export async function processPostAISummaryTask(
  env: Env,
  db: DB,
  cache: CacheImpl,
  serverConfig: ConfigReader,
  payload: {
    postId: number;
    expectedUpdatedAt?: string;
    expectedUpdatedAtUnix?: number;
  },
  clearPostCache: (cache: CacheImpl, id: number, alias: string | null, newAlias: string | null) => Promise<void>,
) {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, payload.postId),
  });

  if (!post) {
    return;
  }

  if (!matchesExpectedUpdatedAt(post.updatedAt, payload)) {
    return;
  }

  const aiConfig = await getAIConfig(serverConfig);
  if (!aiConfig.enabled || post.draft === 1) {
    await db
      .update(posts)
      .set(buildStatusUpdate("idle"))
      .where(eq(posts.id, post.id));
    await clearPostCache(cache, post.id, post.alias, post.alias);
    return;
  }

  await db
    .update(posts)
    .set(buildStatusUpdate("processing"))
    .where(eq(posts.id, post.id));

  const result = await generateAISummaryResult(env, serverConfig, post.content);
  if (result.summary) {
    await db
      .update(posts)
      .set(
        buildStatusUpdate("completed", {
          ai_summary: result.summary,
        }),
      )
      .where(eq(posts.id, post.id));
  } else if (result.skipped) {
    await db
      .update(posts)
      .set(buildStatusUpdate("idle"))
      .where(eq(posts.id, post.id));
  } else {
    await db
      .update(posts)
      .set(
        buildStatusUpdate("failed", {
          ai_summary_error: result.error ?? "Unknown AI summary generation error",
        }),
      )
      .where(eq(posts.id, post.id));
  }

  await clearPostCache(cache, post.id, post.alias, post.alias);
}
