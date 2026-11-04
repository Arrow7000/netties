import { CHAT_SYSTEM } from "../../src/create/prompt.ts";
import { CHAT_LIMITS, type Counters, type Deps, handleCreate } from "./create.ts";
import { callOpenRouter } from "./openrouter.ts";

/**
 * Thinking counts too. The small models we tried think for about 27,000 tokens
 * on a hard request, so the 11,000 of /api/create would cut most of them off.
 */
export const CHAT_MAX_TOKENS = 32_000;

export interface ChatServer {
  /** The model on OpenRouter; with none, there is no chat here. */
  model: string | undefined;
  apiKey: string | undefined;
  counters: Counters;
  visitor: string;
  /** In place of the real model, for trying the page out without paying. */
  callModel?: Deps["callModel"];
}

/** POST /api/chat: a conversation with the model, on the same footing as /api/create but with its own limits. */
export function handleChat(req: Request, s: ChatServer): Promise<Response> | Response {
  if (!s.model) return new Response("Not found", { status: 404 });
  const { model, apiKey } = s;
  return handleCreate(req, {
    counters: s.counters,
    visitor: s.visitor,
    now: new Date(),
    limits: CHAT_LIMITS,
    callModel: s.callModel ?? ((messages) => callOpenRouter({ apiKey: apiKey ?? "", model, system: CHAT_SYSTEM, maxTokens: CHAT_MAX_TOKENS, messages })),
  });
}
