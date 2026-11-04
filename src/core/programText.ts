import { type ComponentDef, Groups, type GroupsJSON } from "./groups";
import { Net, type End, port, free } from "./net";
import { System } from "./system";
import { ParseError, parse, print, printNet } from "./text";

/** Component bodies and instance annotations share the same flat-net notation.
 * Agent references are zero-based first appearances in that body's equations.
 * Instance references are zero-based annotation order, scoped to that body.
 * Keeping actual instance membership (rather than matching it to its template)
 * also preserves nested instances and independently edited component definitions.
 */
export interface Program {
  system: System;
  net: Net;
  components: ComponentDef[];
  groups: Groups;
}
const quoted = '"(?:[^"\\\\]|\\\\.)*"';
const componentHeader = new RegExp(`^component (${quoted}) (${quoted}) (${quoted}) ports (.*)$`);
const symbolLine = new RegExp(`^symbol ([^\\s]+) (${quoted});$`);
const reserved = new Set(["agent", "free", "directions", "types", "component", "instance", "end", "symbol", "_"]);
const safeSymbol = (symbol: string) => /^[^\s(),;~"\\]+$/u.test(symbol) && !symbol.includes("><") && !symbol.includes("=>") && !symbol.includes("--") && !symbol.includes("//") && !reserved.has(symbol) && !/^[xyw]\d+$/.test(symbol);

const instanceLine = new RegExp(`^instance (${quoted}) parent (-|\\d+) (collapsed|expanded) members (\\[.*\\]) ports (\\[.*\\]);$`);

type Boundary = [string, number, number] | [string, string];
export function printBody(system: System, net: Net, groups = new Groups()) {
  const { text, order } = printNet(system, net);
  const indices = new Map(order.map((id, i) => [id, i]));
  const gs = [...groups.groups.values()];
  const groupIndices = new Map(gs.map((g, i) => [g.id, i]));
  const annotations = gs.map(g => {
    const members = order.flatMap((id, i) => groups.of.get(id) === g.id ? [i] : []);
    const iface: Boundary[] = g.iface.map(([name, e]) => e.kind === "port"
      ? [name, indices.get(e.agent)!, e.slot] : [name, e.name]);
    return `instance ${JSON.stringify(g.def)} parent ${g.parent === undefined ? "-" : groupIndices.get(g.parent)} ${g.collapsed ? "collapsed" : "expanded"} members ${JSON.stringify(members)} ports ${JSON.stringify(iface)};`;
  });
  return { text: text + annotations.map(s => s + "\n").join(""), order, groupOrder: gs.map(g => g.id) };
}

export function printProgram(program: Program): string {
  const { net, components, groups } = program;
  // Agent display symbols may contain spaces or collide. Give only those types
  // a lexical alias; display metadata remains readable and lossless.
  const system = System.fromJSON(program.system.toJSON());
  const counts = new Map<string, number>();
  for (const t of system.types.values()) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
  const used = new Set([...system.types.values()].map(t => t.symbol));
  const symbols: string[] = [];
  let fresh = 0;
  for (const [id, t] of system.types) {
    if (safeSymbol(t.symbol) && counts.get(t.symbol) === 1) continue;
    let alias: string;
    do { alias = `T${fresh++}`; } while (used.has(alias));
    used.add(alias);
    symbols.push(`symbol ${alias} ${JSON.stringify(t.symbol)};\n`);
    system.types.set(id, { ...t, symbol: alias });
  }
  const definitions = components.map(d => {
    const body = printBody(system, Net.fromJSON(d.net), Groups.fromJSON(d.groups)).text;
    return `component ${JSON.stringify(d.id)} ${JSON.stringify(d.symbol)} ${JSON.stringify(d.name)} ports ${JSON.stringify(d.iface)}\n${body}end\n`;
  }).join("\n");
  return print(system, new Net()) + symbols.join("") + definitions + printBody(system, net, groups).text;
}

function parseBody(source: string, systemText: string) {
  const lines = source.split("\n");
  const annotations: { match: RegExpExecArray; line: number }[] = [];
  const equations = lines.map((line, i) => {
    const match = instanceLine.exec(line.trim());
    if (!match) return line;
    annotations.push({ match, line: i + 1 });
    return "";
  }).join("\n");
  const { net } = parse(systemText + equations);
  const order = [...net.agents.keys()]; // parser builds outer terms before their arguments
  const groups = new Groups();
  for (const { match: m, line } of annotations) {
    const fail = () => { throw new ParseError("invalid component instance", line); };
    const def = JSON.parse(m[1]!) as string;
    const parent = m[2] === "-" ? undefined : Number(m[2]) + 1;
    const members: unknown = JSON.parse(m[4]!);
    const boundaries: unknown = JSON.parse(m[5]!);
    if (!Array.isArray(members) || !Array.isArray(boundaries)) fail();
    const iface: [string, End][] = (boundaries as unknown[]).map(b => {
      if (!Array.isArray(b) || typeof b[0] !== "string") return fail();
      if (b.length === 2 && typeof b[1] === "string") return [b[0], free(b[1])];
      if (b.length !== 3 || !Number.isInteger(b[1]) || !Number.isInteger(b[2])) return fail();
      const id = order[b[1]];
      if (id === undefined || b[2] < 0 || b[2] >= net.agent(id).wires.length) return fail();
      return [b[0], port(id, b[2])];
    });
    const id = groups.add({ def, parent, collapsed: m[3] === "collapsed", iface });
    for (const index of members as unknown[]) {
      if (typeof index !== "number" || !Number.isInteger(index) || order[index] === undefined) fail();
      const agent = order[index as number]!;
      if (groups.of.has(agent)) fail();
      groups.of.set(agent, id);
    }
  }
  for (const g of groups.groups.values()) {
    const seen = new Set<number>();
    for (let id: number | undefined = g.id; id !== undefined; id = groups.groups.get(id)?.parent) {
      if (seen.has(id) || !groups.groups.has(id)) throw new Error("invalid component nesting");
      seen.add(id);
    }
    const members = new Set(groups.members(g.id));
    for (const [, e] of g.iface) if (e.kind === "port" && !members.has(e.agent)) throw new Error("component boundary outside its members");
  }
  return { net, groups };
}

export function parseProgram(source: string): Program {
  const lines = source.split("\n");
  const main: string[] = [];
  const symbols = new Map<string, string>();
  const bodies: { header: RegExpExecArray; lines: string[] }[] = [];
  let body: typeof bodies[number] | undefined;
  for (const line of lines) {
    const symbol = symbolLine.exec(line.trim());
    if (symbol && !body) {
      if (symbols.has(symbol[1]!)) throw new Error("duplicate symbol annotation");
      symbols.set(symbol[1]!, JSON.parse(symbol[2]!) as string);
      continue;
    }
    const header = componentHeader.exec(line.trim());
    if (header) {
      if (body) throw new Error("component definitions cannot be nested; use instance annotations");
      body = { header, lines: [] };
      bodies.push(body);
    } else if (line.trim() === "end" && body) body = undefined;
    else (body ? body.lines : main).push(line);
  }
  if (body) throw new Error("component definition is missing end");
  const mainText = main.join("\n");
  const { system } = parse(mainText.split("\n").filter(l => !instanceLine.test(l.trim())).join("\n"));
  const systemText = print(system, new Net());
  const parsed = parseBody(mainText, "");
  const components = bodies.map(({ header: h, lines }) => {
    const id = JSON.parse(h[1]!) as string;
    const symbol = JSON.parse(h[2]!) as string;
    const name = JSON.parse(h[3]!) as string;
    const iface: unknown = JSON.parse(h[4]!);
    if (!Array.isArray(iface) || iface.some(n => typeof n !== "string") || new Set(iface).size !== iface.length) throw new Error("invalid component interface");
    const { net, groups } = parseBody(lines.join("\n"), systemText);
    for (const agent of net.agents.values()) if (!system.types.has(agent.type)) throw new Error(`unknown agent type ${agent.type} in component`);
    if (iface.length !== net.free.size || iface.some(n => !net.free.has(n))) throw new Error("component interface does not match its free ports");
    return { id, symbol, name, iface: iface as string[], net: net.toJSON(), groups: groups.toJSON() } satisfies ComponentDef;
  });
  const defs = new Map(components.map(d => [d.id, d]));
  if (defs.size !== components.length) throw new Error("duplicate component definition");
  const validate = (groups: GroupsJSON, stack: Set<string>) => {
    for (const g of groups.groups) {
      const def = defs.get(g.def);
      if (!def) throw new Error(`unknown component ${g.def}`);
      const names = new Set(g.iface.map(([name]) => name));
      if (names.size !== g.iface.length || names.size !== def.iface.length || def.iface.some(name => !names.has(name))) throw new Error("component instance interface does not match its definition");
      if (stack.has(g.def)) throw new Error("recursive component definition");
      validate(def.groups, new Set([...stack, g.def]));
    }
  };
  validate(parsed.groups.toJSON(), new Set());
  for (const d of components) validate(d.groups, new Set([d.id]));
  for (const [id, symbol] of symbols) {
    if (!system.types.has(id)) throw new Error("unknown agent in symbol annotation");
    system.types.set(id, { ...system.type(id), symbol });
  }
  return { system, ...parsed, components };
}
