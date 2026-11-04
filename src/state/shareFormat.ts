import { Groups } from "../core/groups";
import { Net } from "../core/net";
import { System } from "../core/system";
import { parseProgram, printBody, printProgram } from "../core/programText";
import type { Placed } from "../layout/geometry";
import type { Doc } from "./persist";

/** Indices are implicit: entry n belongs to the nth agent in the main text.
 * Component boxes have no independent placement: the editor derives them from
 * their members. Retaining hidden members' placements preserves expansion too.
 */
type Position = [x: number, y: number, up: 0 | 1] | null;
export type SharePayload = [version: 2, text: string] | [version: 2, text: string, manual: Position[]];

export function sharePayload(doc: Doc): SharePayload {
  const system = System.fromJSON(doc.system);
  const net = Net.fromJSON(doc.net);
  const groups = Groups.fromJSON(doc.groups);
  const text = printProgram({ system, net, groups, components: doc.components ?? [] });
  if (doc.mode === "auto") return [2, text];
  const positions = new Map(doc.positions);
  const { order } = printBody(system, net, groups);
  const manual: Position[] = order.map(id => {
    const p = positions.get(id);
    if (!p) return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("invalid position");
    return [p.x, p.y, p.orient === "up" ? 1 : 0];
  });
  return [2, text, manual];
}

export function readSharePayload(payload: unknown): Doc {
  if (!Array.isArray(payload) || payload[0] !== 2 || typeof payload[1] !== "string" || (payload.length !== 2 && payload.length !== 3)) throw new Error("unknown share format");
  const { system, net, groups, components } = parseProgram(payload[1]);
  const positions: [number, Placed][] = [];
  if (payload.length === 3) {
    const manual: unknown = payload[2];
    if (!Array.isArray(manual) || manual.length !== net.agents.size) throw new Error("invalid manual layout");
    [...net.agents.keys()].forEach((id, i) => {
      const p: unknown = manual[i];
      if (p === null) return;
      if (!Array.isArray(p) || p.length !== 3 || typeof p[0] !== "number" || !Number.isFinite(p[0]) || typeof p[1] !== "number" || !Number.isFinite(p[1]) || (p[2] !== 0 && p[2] !== 1)) throw new Error("invalid manual position");
      positions.push([id, { x: p[0], y: p[1], orient: p[2] ? "up" : "down" }]);
    });
  }
  return { v: 1, system: system.toJSON(), net: net.toJSON(), components, groups: groups.toJSON(),
    mode: payload.length === 3 ? "manual" : "auto", ...(payload.length === 3 ? { positions } : {}) };
}
