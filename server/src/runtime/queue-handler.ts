import { drizzle } from "drizzle-orm/d1";
import { CacheImpl } from "../utils/cache";
import { isQueueTask, _POST_AI_SUMMARY_TASK } from "../queue";
import { processPostAISummaryTask } from "../services/post-ai-summary";
import { clearPostCache } from "../services/post";

export async function handleQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
) {
  const schema = await import("../db/schema");
  const db = drizzle(env.DB, { schema });
  const serverConfig = new CacheImpl(db, env, "server.config", "database");
  const clientConfig = new CacheImpl(db, env, "client.config", "database");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  for (const message of batch.messages) {
    const body = message.body;
    if (!isQueueTask(body)) {
      message.ack();
      continue;
    }

    switch (body.type) {
      case _POST_AI_SUMMARY_TASK:
        await processPostAISummaryTask(
          env,
          db,
          cache,
          serverConfig,
          body.payload,
          clearPostCache,
        );
        message.ack();
        break;
      default:
        message.ack();
        break;
    }
  }
}
