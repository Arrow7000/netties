import { type Example, examples } from "../core/examples";
import { Groups } from "../core/groups";
import { printProgram } from "../core/programText";

/** What the model is told to look at: one line for each of the app's examples. */
export const exampleIndex = () => examples.map((ex) => `- ${ex.name}: ${ex.about}`).join("\n");

/** The example meant by a name: models shorten them, as in "Fibonacci" for "Fibonacci: 6 → 8". If that could mean several, it means none. */
function exampleCalled(name: string): Example | undefined {
  const wanted = name.toLowerCase();
  const exact = examples.find((e) => e.name.toLowerCase() === wanted);
  if (exact) return exact;
  const near = examples.filter((e) => e.name.toLowerCase().includes(wanted));
  return near.length === 1 ? near[0] : undefined;
}

function documentOf(ex: Example): string {
  const system = ex.system();
  return printProgram({ system, net: ex.net(system), components: [], groups: new Groups() });
}

const namesIn = (block: string) =>
  block
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*]\s+)?/, "").trim())
    .filter(Boolean);

/**
 * The names asked for in a reply, if that's what it is. That's a block marked
 * `examples`; models also mark it as something else, so any block that holds
 * nothing but examples' names counts. A reply with a document isn't asking.
 */
export function namesAskedFor(reply: string): string[] | undefined {
  if (/```inet\s*\n/.test(reply)) return undefined;
  const blocks = [...reply.matchAll(/```(\w*)\s*\n([\s\S]*?)```/g)];
  const marked = blocks.filter((b) => b[1] === "examples");
  if (marked.length) return marked.flatMap((b) => namesIn(b[2]!));
  const names = blocks.flatMap((b) => namesIn(b[2]!));
  return names.length && names.every((n) => exampleCalled(n)) ? names : undefined;
}

/** What netties says back: the documents asked for. */
export function examplesReply(names: string[]): string {
  if (!names.length) return "netties says: that block didn't name any examples. Write one name per line, exactly as listed.";
  const parts = names.map((name) => {
    const ex = exampleCalled(name);
    return ex ? `# ${ex.name}\n\n\`\`\`inet\n${documentOf(ex).trimEnd()}\n\`\`\`` : `There's no example called "${name}". Use a name exactly as listed.`;
  });
  return `netties says: here's what you asked for. The visitor doesn't see this message, so don't refer to it as something they sent.\n\n${parts.join("\n\n")}\n\nCarry on with what the visitor asked.`;
}
