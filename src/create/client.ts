/** What the chat and the eval share about a model's tries at a document. */

export const TRIES = 3;

/** What we tell the model when its document doesn't check out. */
export const feedbackMessage = (feedback: string) => `netties says: ${feedback}\n\nReply with the whole corrected document.`;

/** A content block of the model's reply. */
export type Block = { type: string; text?: string };
export type Message = { role: "user"; content: string; images?: Blob[] } | { role: "assistant"; content: Block[] };
