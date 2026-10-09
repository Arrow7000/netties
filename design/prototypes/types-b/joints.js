/* joints.js: direction B draws a port's type into the agent's outline.
   A port that gives has a tab sticking out; a port that takes has a slot
   cut in. The joint's shape is the type name: pointed for no name, round
   for the first name, square for the second. Untyped ports stay plain, so
   an untyped system looks exactly like today. */
(function () {
  "use strict";
  const NK = window.NetKit;
  const f2 = (v) => v.toFixed(2);
  const P = (p) => f2(p[0]) + "," + f2(p[1]);
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
  const unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const SHAPES = ["round", "square"];
  function shapeOf(sys, pt) {
    if (!pt || !pt.pol) return null;
    if (!pt.name) return "vee";
    const i = sys && sys.names ? sys.names.findIndex((n) => n.id === pt.name) : 0;
    return SHAPES[i % SHAPES.length] || "round";
  }
  // Path commands from c-t*w to c+t*w through a bump (k=1, out along n) or a notch (k=-1).
  function joint(c, t, n, shape, k, w, d) {
    const a = add(c, t, -w), b = add(c, t, w), o = [n[0] * k * d, n[1] * k * d];
    if (shape === "round") return `L${P(a)} C${P(add(a, o, 1.33))} ${P(add(b, o, 1.33))} ${P(b)}`;
    if (shape === "square") return `L${P(a)} L${P(add(a, o))} L${P(add(b, o))} L${P(b)}`;
    return `L${P(a)} L${P(add(c, o))} L${P(b)}`;
  }
  const W = 3.9, D = 3.7;
  // The outline of an agent with joints; ports: [{pol,name}|null] per slot.
  // Returns { d, plugs } where plugs[i] is the inner end of a slot (for the wire to reach into).
  function outline(a, ports, sys) {
    const o = a.outline, plugs = [];
    const sh = (i) => shapeOf(sys, ports && ports[i]);
    const kind = (i) => (ports && ports[i] && ports[i].pol === "give" ? 1 : -1);
    if (o.circle) {
      const C = [o.circle.cx, o.circle.cy], r = o.circle.r;
      // joints on the circle: walk around from each port
      const angs = a.ports.map((p) => Math.atan2(p[1] - C[1], p[0] - C[0]));
      const order = angs.map((g, i) => [g, i]).sort((x, y) => x[0] - y[0]);
      if (!order.some(([, i]) => sh(i))) return null;
      const dl = Math.asin(Math.min(0.9, W / r));
      let d = "";
      order.forEach(([g, i], k) => {
        const s = sh(i);
        const q1 = [C[0] + r * Math.cos(g - dl), C[1] + r * Math.sin(g - dl)], q2 = [C[0] + r * Math.cos(g + dl), C[1] + r * Math.sin(g + dl)];
        if (!d) d = `M${P(q1)}`;
        if (s) {
          const c = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2], t = unit(q1, q2), n = [Math.cos(g), Math.sin(g)];
          d += " " + joint(c, t, n, s, kind(i), Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) / 2, D);
          if (kind(i) < 0) plugs[i] = add(c, n, -D + 0.4);
        } else d += ` A${r} ${r} 0 0 1 ${P(q2)}`;
        const next = order[(k + 1) % order.length][0] + (k + 1 === order.length ? Math.PI * 2 : 0);
        const e = [C[0] + r * Math.cos(next - dl), C[1] + r * Math.sin(next - dl)];
        const span = next - dl - (g + dl);
        d += ` A${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${P(e)}`;
      });
      return { d: d + " Z", plugs };
    }
    if (o.polygon) {
      const [L, R, A] = o.polygon, s = a.orient === "down" ? 1 : -1;
      if (!a.ports.some((_, i) => sh(i))) return null;
      const nb = [0, -s];
      let d = `M${P(L)}`;
      const aux = a.ports.map((p, i) => [p, i]).filter(([, i]) => i > 0).sort((x, y) => x[0][0] - y[0][0]);
      for (const [p, i] of aux) {
        const s2 = sh(i); if (!s2) continue;
        d += " " + joint(p, [1, 0], nb, s2, kind(i), W, D);
        if (kind(i) < 0) plugs[i] = add(p, nb, -D + 0.4);
      }
      d += ` L${P(R)}`;
      const s0 = sh(0);
      if (s0) {
        const c = 5.4, pr = add(A, unit(A, R), c), pl = add(A, unit(A, L), c);
        const m = [(pr[0] + pl[0]) / 2, (pr[1] + pl[1]) / 2], hw = Math.hypot(pl[0] - pr[0], pl[1] - pr[1]) / 2, h = Math.abs(A[1] - m[1]);
        const n0 = [0, s], k = kind(0);
        d += ` L${P(pr)} ` + joint(m, unit(pr, pl), n0, s0, k, s0 === "vee" && k > 0 ? hw * 0.62 : hw, k > 0 ? h + (s0 === "vee" ? 4.2 : 1.6) : D + 0.6);
        if (k < 0) plugs[0] = add(m, n0, -(D + 0.6) + 0.4);
      } else d += ` L${P(A)}`;
      return { d: d + ` L${P(L)} Z`, plugs };
    }
    return null;
  }
  // Agent SVG with joints (falls back to the plain shape).
  function agentSVG(a, type, sys, ports) {
    ports = ports || (type && type.ports);
    const base = NK.agentShapeSVG(a, type);
    if (!ports || !type || type.component) return base;
    const ol = outline(a, ports, sys); if (!ol) return base;
    const filled = type.filled;
    // keep the symbol text, swap the outline
    const sym = base.match(/<text[\s\S]*<\/text>/);
    return `<path d="${ol.d}" class="nk-shape${filled ? " filled" : ""}" stroke-linejoin="round"/>` + (sym ? sym[0] : "");
  }
  function plugs(a, ports, sys) { const ol = outline(a, ports, sys); return ol ? ol.plugs : []; }
  // A loose end, drawn as a short cap with the matching joint facing the net.
  function capSVG(x, y, toNet, pt, sys, cls = "") {
    const s = shapeOf(sys, pt); if (!s) return null;
    const t = [Math.abs(toNet[1]), Math.abs(toNet[0])], c = [x, y];
    const k = pt.pol === "give" ? -1 : 1; // the outside takes what the port gives: slot facing it
    const a = add(c, t, -6), b = add(c, t, 6);
    return `<path d="M${P(a)} ${joint(c, t, toNet, s, k, W * 0.95, D * 0.95)} L${P(b)}" class="jb-cap ${cls}"/>`;
  }
  // Tiny tab + slot pair for legends.
  // a little block whose top edge carries the joint, like the edge of an agent
  function block(shape, k, dx = 0) {
    const j = joint([dx, 0], [1, 0], [0, -1], shape, k, W, D);
    return `<path d="M${dx - 7} 5.5 L${dx - 7} 0 ${j} L${dx + 7} 0 L${dx + 7} 5.5 Z" class="jb-leg"/>`;
  }
  function legendSVG(shape, size = 16) {
    return `<svg width="${size * 2.1}" height="${size}" viewBox="-8.5 -5 33 11.5" aria-hidden="true">${block(shape, 1)}${block(shape, -1, 16)}</svg>`;
  }
  function jointSVG(shape, kind, size = 14) {
    return `<svg width="${size}" height="${size * 0.8}" viewBox="-8 -5 16 11.5" aria-hidden="true" style="vertical-align:-2px">${block(shape, kind === "give" ? 1 : -1)}</svg>`;
  }
  window.Joints = { outline, agentSVG, plugs, capSVG, legendSVG, jointSVG, shapeOf, W, D };
})();
