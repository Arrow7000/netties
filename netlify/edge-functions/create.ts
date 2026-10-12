import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/edge-functions";
import { SYSTEM } from "../../src/create/prompt.ts";
import { type Counters, MAX_TOKENS, MODEL, handleCreate } from "../lib/create.ts";

/** POST /api/create: see ../lib/create.ts. Needs ANTHROPIC_API_KEY in the site's environment. */
export default async (req: Request, context: Context) => {
  const client = new Anthropic({ apiKey: Netlify.env.get("ANTHROPIC_API_KEY") });
  const store = getStore({ name: "create-limits", consistency: "strong" });
  const counters: Counters = {
    get: async (key) => Number((await store.get(key)) ?? 0),
    set: (key, value) => store.set(key, String(value)).then(() => undefined),
  };
  return handleCreate(req, {
    counters,
    visitor: context.ip,
    now: new Date(),
    callModel(messages) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        messages,
      });
      async function* text() {
        for await (const e of stream) if (e.type === "content_block_delta" && e.delta.type === "text_delta") yield e.delta.text;
      }
      return {
        text: text(),
        final: stream.finalMessage().then((m) => ({ content: m.content, stop: m.stop_reason, usage: m.usage })),
      };
    },
  });
};

export const config: Config = { path: "/api/create", method: "POST" };
