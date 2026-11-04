import type { End, Net } from "../core/net";
import { type Stats, normalize, redexes } from "../core/reduce";
import type { System } from "../core/system";
import { parseProgram } from "../core/programText";
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
  if (code === undefined) return { ok: false, stage: "no-code", feedback: "I couldn't find a fenced code block in your reply. Send your best attempt at what was asked, not something easier: netties will tell you what's wrong with it." };

  let sys: System;
  let net: Net;
  try {
    ({ system: sys, net } = parse(code));
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, stage: "parse", feedback: `The text didn't parse: ${e.message}.${bracketSlip(code, e.line) ?? ""}` };
    return { ok: false, stage: "parse", feedback: `The text didn't load: ${(e as Error).message}.` };
  }

  const typeProblems = checkTypes(sys, net);
  if (typeProblems.length) return { ok: false, stage: "types", feedback: `The types don't check:\n- ${typeProblems.join("\n- ")}` };

  const empty = net.unconnected().filter((e) => e.kind === "port");
  if (empty.length) return { ok: false, stage: "interface", feedback: `Some ports in the starting net aren't connected: ${empty.map((e) => describe(sys, net, e)).join(", ")}.` };
  const problem = before?.(sys, net);
  if (problem) return { ok: false, stage: "interface", feedback: problem };

  const { stats, problem: runProblem } = run(sys, net);
  if (runProblem) return { ok: false, stage: "run", feedback: runProblem };
  return { ok: true, code, sys, net, stats };
}

/** Run a net to the end, and say so if it never stops or gets stuck. */
function run(sys: System, net: Net): { stats: Stats; problem?: string } {
  const { normal, stats } = normalize(net, sys, { limit: LIMIT });
  if (!normal) return { stats, problem: `The net was still running after ${LIMIT} interactions; it probably never stops.` };
  const stuck = net.activePairs().filter((w) => !redexes(net, sys).includes(w));
  if (!stuck.length) return { stats };
  const pairs = new Set(
    stuck.map((w) => {
      const [a, b] = net.wire(w).ends as [Extract<End, { kind: "port" }>, Extract<End, { kind: "port" }>];
      return `${sys.type(net.agent(a.agent).type).symbol} meets ${sys.type(net.agent(b.agent).type).symbol}`;
    }),
  );
  return { stats, problem: `The net got stuck after ${stats.interactions} interactions: ${[...pairs].join("; ")}, and there's no rule for that pair.\nIt stopped as:\n${netText(sys, net)}` };
}

/**
 * The document in a chat reply, if it has one. A reply can be words alone, and
 * a code block that isn't a document is only an illustration.
 */
export function extractDocument(reply: string): string | undefined {
  const marked = [...reply.matchAll(/```inet\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  if (marked.length) return marked.at(-1)!;
  const code = extractCode(reply);
  return code !== undefined && /^\s*agent /m.test(code) ? code : undefined;
}

export type DocumentCheck =
  /** It parses, its types check, and it runs to the end. */
  | { kind: "fine"; types: number; rules: number; interactions: number }
  /** It works as a document, but running it got stuck or never stopped, which may or may not be the idea. */
  | { kind: "concern"; types: number; rules: number; feedback: string }
  /** It can't go on the canvas. */
  | { kind: "wrong"; feedback: string };

/**
 * Checking a document in a chat, which unlike `checkReply` doesn't ask for
 * anything of its own: not directions, not types, not a finished system.
 */
export function checkDocument(code: string): DocumentCheck {
  let sys: System;
  let net: Net;
  try {
    ({ system: sys, net } = parseProgram(code));
  } catch (e) {
    if (e instanceof ParseError) return { kind: "wrong", feedback: `The text didn't parse: ${e.message}.${bracketSlip(code, e.line) ?? ""}` };
    return { kind: "wrong", feedback: `The text didn't load: ${(e as Error).message}.` };
  }
  const types = typeProblems(sys, net);
  if (types.length) return { kind: "wrong", feedback: `The types don't check:\n- ${types.join("\n- ")}` };
  const size = { types: sys.types.size, rules: sys.rules.size };
  const { stats, problem } = run(sys, net);
  return problem ? { kind: "concern", ...size, feedback: problem } : { kind: "fine", ...size, interactions: stats.interactions };
}

/**
 * Where a bracket error on a line really began. A ")" too many is only noticed
 * at the end of the line, long after the slip, so look for the first agent that
 * closes with the wrong number of terms, and count the brackets of what it holds.
 */
export function bracketSlip(code: string, lineNo: number): string | undefined {
  const lines = code.split("\n");
  const line = lines[lineNo - 1];
  if (line === undefined) return undefined;
  const arity = new Map<string, number>();
  for (const l of lines) {
    const m = /^\s*agent\s+(\S+)\s+(\d+)/.exec(l);
    if (m) arity.set(m[1]!, Number(m[2]));
  }
  const open: { name: string; at: number; terms: number }[] = [];
  for (const m of line.matchAll(/[(),]|[^\s(),;~]+/g)) {
    const t = m[0];
    if (t === "(") open.push({ name: line.slice(0, m.index).trimEnd().split(/[\s(),;~]/).at(-1) ?? "", at: m.index, terms: 1 });
    else if (t === ",") {
      if (open.length) open.at(-1)!.terms++;
    } else if (t === ")") {
      const top = open.pop();
      if (!top) return undefined;
      const want = arity.get(top.name);
      if (want === undefined || want === top.terms) continue;
      // The term that was being written when the agent closed.
      const held = line.slice(top.at + 1, m.index + 1);
      const inner = held.slice(held.lastIndexOf(",") < 0 ? 0 : held.lastIndexOf(",") + 1).trim();
      const count = (c: string) => inner.split(c).length - 1;
      return (
        `\nThe slip is earlier than that: ${top.name}( at column ${top.at + 1} closes with ${top.terms} term${top.terms === 1 ? "" : "s"}, but ${top.name} takes ${want}. ` +
        `The part ending there, ${inner}, has ${count("(")} "(" and ${count(")")} ")".\n` +
        "Deep brackets are easy to miscount. Don't try to count them again: write long numbers across named wires instead, a layer or two at a time, as in a ~ S(S(b)); b ~ S(S(c)); c ~ S(0);"
      );
    }
  }
  return undefined;
}

function checkTypes(sys: System, net: Net): string[] {
  const out: string[] = [];
  if (sys.typing.dirs !== "required") out.push("Start the document with `directions required`.");
  if (sys.typing.types !== "required") out.push("Start the document with `types required` and the type names.");
  return [...out, ...typeProblems(sys, net)];
}

/** Whatever breaks the types the document itself asks for. */
function typeProblems(sys: System, net: Net): string[] {
  const out: string[] = [];
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
