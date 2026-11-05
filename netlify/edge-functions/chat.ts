import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/edge-functions";
import { handleChat } from "../lib/chat.ts";
import type { Counters } from "../lib/create.ts";

/**
 * POST /api/chat and /api/chat/title: see ../lib/chat.ts. There's no chat unless the site's
 * environment sets CHAT_MODEL (and OPENROUTER_API_KEY), so it's 404 in production for now.
 */
export default async (req: Request, context: Context) => {
  const store = getStore({ name: "chat-limits", consistency: "strong" });
  const counters: Counters = {
    get: async (key) => Number((await store.get(key)) ?? 0),
    set: (key, value) => store.set(key, String(value)).then(() => undefined),
  };
  return handleChat(req, { model: Netlify.env.get("CHAT_MODEL"), apiKey: Netlify.env.get("OPENROUTER_API_KEY"), counters, visitor: context.ip });
};

export const config: Config = { path: ["/api/chat", "/api/chat/title"], method: "POST" };
