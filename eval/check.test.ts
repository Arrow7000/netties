import { describe, expect, it } from "vitest";
import { grade } from "./check";
import { EXAMPLE } from "./prompt";

const block = (s: string) => "Here you go.\n```inet\n" + s + "\n```\n";
const N = (value: number) => ({ kind: "number", value }) as const;

const NUMBERS = `directions required
types required number
agent 0 0 "zero" ports +number
agent S 1 "successor" ports +number, -number
agent + 2 "add" ports -number, +number, -number
+(x1, x2) >< 0 => x1 ~ x2;
+(x1, x2) >< S(y1) => x1 ~ S(w1), y1 ~ +(w1, x2);
`;

describe("grade", () => {
  it("accepts the system prompt's own example", () => {
    const g = grade(block(EXAMPLE), N(4));
    expect(g).toMatchObject({ stage: "ok", got: "4" });
  });

  it("reads a sum", () => {
    expect(grade(block(NUMBERS + "+(out, S(S(0))) ~ S(S(S(0)));"), N(5))).toMatchObject({ stage: "ok" });
  });

  it("says what a wrong answer read as, without giving the right one", () => {
    const g = grade(block(NUMBERS + "+(out, S(0)) ~ S(S(S(0)));"), N(5));
    expect(g.stage).toBe("wrong");
    expect(g.feedback).toContain("out reads as 4");
    expect(g.feedback).not.toContain("5");
  });

  it("reports parse errors with the line", () => {
    const g = grade(block(NUMBERS + "+(out, S(0) ~ 0;"), N(1));
    expect(g.stage).toBe("parse");
    expect(g.feedback).toMatch(/line \d+/);
  });

  it("insists on directions and types", () => {
    const g = grade(block("agent Z 0\nout ~ Z;"), N(0));
    expect(g.stage).toBe("types");
    expect(g.feedback).toContain("directions required");
  });

  it("reports rules that break the types", () => {
    const g = grade(block(NUMBERS.replace("x1 ~ x2;", "x2 ~ S(x1);") + "out ~ 0;"), N(0));
    expect(g.stage).toBe("types");
    expect(g.feedback).toContain("+ >< 0");
  });

  it("reports stuck pairs", () => {
    const src = NUMBERS.replace("+(x1, x2) >< 0 => x1 ~ x2;\n", "") + "+(out, S(0)) ~ 0;";
    const g = grade(block(src), N(1));
    expect(g.stage).toBe("run");
    expect(g.feedback).toMatch(/\+ meets 0|0 meets \+/);
  });

  it("wants nothing left over", () => {
    const g = grade(block(NUMBERS + "out ~ S(0), a ~ S(b), b ~ 0, +(a, c) ~ S(c);"), N(1));
    expect(g.stage).not.toBe("ok");
  });

  it("wants no loose ends but out", () => {
    const g = grade(block(NUMBERS + "out ~ S(x);"), N(1));
    expect(g.stage).toBe("interface");
  });

  it("reads lists and booleans", () => {
    const lists = `directions required
types required number list
agent 0 0 ports +number
agent S 1 ports +number, -number
agent nil 0 ports +list
agent cons 2 ports +list, -number, -list
out ~ cons(S(0), cons(S(S(0)), nil));`;
    expect(grade(block(lists), { kind: "list", value: [1, 2] })).toMatchObject({ stage: "ok" });
    const bools = `directions required
types required boolean
agent T 0 "true" ports +boolean
agent F 0 "false" ports +boolean
agent ¬ 1 "not" ports -boolean, +boolean
¬(x1) >< T => x1 ~ F;
¬(x1) >< F => x1 ~ T;
¬(out) ~ F;`;
    expect(grade(block(bools), { kind: "bool", value: true })).toMatchObject({ stage: "ok", got: "true" });
  });

  it("skips a language tag on its own line", () => {
    expect(grade("```\ninet\n" + NUMBERS + "+(out, S(S(0))) ~ S(S(S(0)));\n```", N(5))).toMatchObject({ stage: "ok" });
  });

  it("takes an unfenced document as it is", () => {
    expect(grade(NUMBERS + "+(out, S(S(0))) ~ S(S(S(0)));", N(5))).toMatchObject({ stage: "ok" });
  });

  it("notices a missing code block", () => {
    expect(grade("I think the answer is 5.", N(5)).stage).toBe("no-code");
  });
});
