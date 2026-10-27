/**
 * The order of the Selection view's actions (./focus.tsx), on the net and
 * in a rule alike. Plain, so it can be tested without a page.
 */

/** The order actions come in, whatever is selected, after the main one; Delete has a place of its own. */
const ORDER = ["rule", "copy", "duplicate", "flip", "cut", "paste", "change", "select-wire", "ends", "connected", "all", "component", "expand", "apart"];

/**
 * Actions in the one order they always come in, on the net and in a rule:
 * the main one first (Fire, Write rule, Edit component, Stop wiring), then
 * the rest by `ORDER`, with Delete the last of the first row of `row`.
 * Where the rest fold away under More (`folds`), More takes the row's last
 * place, so Delete goes just before it; the whole list keeps that order, so
 * Delete stays put when More opens it. When they all fit in the row, Delete
 * is last.
 */
export function arrange<A extends { id: string; primary?: boolean }>(actions: A[], row: number, folds: boolean): A[] {
  const rank = (a: A) => {
    const i = ORDER.indexOf(a.id);
    return i < 0 ? ORDER.length : i;
  };
  const main = actions.filter((a) => a.primary);
  const del = actions.filter((a) => !a.primary && a.id === "delete");
  const rest = actions.filter((a) => !a.primary && a.id !== "delete").sort((a, b) => rank(a) - rank(b));
  const out = [...main, ...rest];
  if (!del.length) return out;
  const at = out.length + del.length <= row ? out.length : Math.max(0, folds ? row - 2 : row - 1);
  return [...out.slice(0, at), ...del, ...out.slice(at)];
}

/** Of actions in order, those that fit a row of `row`, with `more` in its last place for the rest; all of them if they fit. */
export function firstRow<A>(actions: A[], row: number, more: A): A[] {
  return actions.length <= row ? actions : [...actions.slice(0, row - 1), more];
}
