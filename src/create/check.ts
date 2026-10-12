import type { End, Net } from "../core/net";
import { type Stats, normalize, redexes } from "../core/reduce";
import type { System } from "../core/system";
import { ParseError, parse, print } from "../core/text";
import { badWires, clashText, missing, portName, ruleClashes } from "../core/types";

/**
 * Checking what a model wrote: the same checks a visitor's "create it for
 * me" request goes through, and the eval builds on.
 */

/** How far a reply got. Each stage needs the one before it. */
export type Stage = "no-code" | "parse" | "types" | "interface" | "run";

export type Checked =
  | { ok: true; code: string; sys: System; net: Net; stats: Stats }
  | { ok: false; stage: Stage; feedback: string };

/** More interactions than this and the net probably never stops. */
export const LIMIT = 100_000;

/** The last fenced code block in a reply, or the whole reply if it's an unfenced document. */
export function extractCode(reply: string): string | undefined {
  const blocks = [...reply.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  // Some models put the language tag on its own line inside the fence.
  if (blocks.length) return blocks.at(-1)!.replace(/^\s*inet\s*\n/, "");
  return /^agent /m.test(reply) ? reply : undefined;
}

/**
 * Parse a reply, check its types and run its net to the end. `before` can
 * add a check on the starting net. `net` comes back in its final state.
 */
export function checkReply(reply: string, before?: (sys: System, net: Net) => string | undefined): Checked {
  const code = extractCode(reply);
  if (code === undefined) return { ok: false, stage: "no-code", feedback: "I couldn't find a fenced code block in your reply." };

  let sys: System;
  let net: Net;
  try {
    ({ system: sys, net } = parse(code));
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, stage: "parse", feedback: `The text didn't parse: ${e.message}.` };
    return { ok: false, stage: "parse", feedback: `The text didn't load: ${(e as Error).message}.` };
  }

  const typeProblems = checkTypes(sys, net);
  if (typeProblems.length) return { ok: false, stage: "types", feedback: `The types don't check:\n- ${typeProblems.join("\n- ")}` };

  const empty = net.unconnected().filter((e) => e.kind === "port");
  if (empty.length) return { ok: false, stage: "interface", feedback: `Some ports in the starting net aren't connected: ${empty.map((e) => describe(sys, net, e)).join(", ")}.` };
  const problem = before?.(sys, net);
  if (problem) return { ok: false, stage: "interface", feedback: problem };

  const { normal, stats } = normalize(net, sys, { limit: LIMIT });
  if (!normal) return { ok: false, stage: "run", feedback: `The net was still running after ${LIMIT} interactions; it probably never stops.` };
  const stuck = net.activePairs().filter((w) => !redexes(net, sys).includes(w));
  if (stuck.length) {
    const pairs = new Set(
      stuck.map((w) => {
        const [a, b] = net.wire(w).ends as [Extract<End, { kind: "port" }>, Extract<End, { kind: "port" }>];
        return `${sys.type(net.agent(a.agent).type).symbol} meets ${sys.type(net.agent(b.agent).type).symbol}`;
      }),
    );
    return { ok: false, stage: "run", feedback: `The net got stuck after ${stats.interactions} interactions: ${[...pairs].join("; ")}, and there's no rule for that pair.\nIt stopped as:\n${netText(sys, net)}` };
  }
  return { ok: true, code, sys, net, stats };
}

function checkTypes(sys: System, net: Net): string[] {
  const out: string[] = [];
  if (sys.typing.dirs !== "required") out.push("Start the document with `directions required`.");
  if (sys.typing.types !== "required") out.push("Start the document with `types required` and the type names.");
  for (const m of missing(sys)) out.push(`${sys.type(m.type).symbol}'s ${portName(m.slot)} needs a ${m.what === "dir" ? "direction (+ or -)" : "type"}.`);
  for (const r of sys.rules.values()) {
    for (const c of ruleClashes(sys, r)) out.push(`In the rule ${sys.type(r.left).symbol} >< ${sys.type(r.right).symbol}: ${clashText(c.clash)}`);
  }
  for (const [w, c] of badWires(net, sys)) {
    const [a, b] = net.wire(w).ends;
    out.push(`In the net, the wire from ${describe(sys, net, a)} to ${describe(sys, net, b)}: ${clashText(c)}`);
  }
  return out;
}

export function describe(sys: System, net: Net, e: End): string {
  if (e.kind === "free") return `loose end ${e.name}`;
  return `${sys.type(net.agent(e.agent).type).symbol}'s ${portName(e.slot)}`;
}

/** Just the net's equations, without the declarations and rules. */
export function netText(sys: System, net: Net): string {
  const lines = print(sys, net).split("\n");
  const body = lines.filter((l) => l.trim() && !/^(agent|directions|types) /.test(l) && !l.includes("><"));
  return body.join("\n") || "(an empty net)";
}
