/** A piece runs on to the first line break after this many characters... */
const AT_LEAST = 500;
/** ...or is cut at a space by this many, if the text has no line breaks. */
const AT_MOST = 4000;

/**
 * Text that keeps growing, cut into pieces to show as a block each: the browser
 * then only lays out the last block when more comes in, not all of it, which
 * for a long trace is the difference between a smooth page and a frozen one.
 * Where a piece ends depends only on what comes before it, so a finished piece
 * never changes. A line break that ends a piece is dropped, as the next block starts a new line anyway.
 */
export function pieces(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const window = text.slice(from + AT_LEAST, from + AT_MOST);
    const line = window.indexOf("\n");
    if (line >= 0) {
      const end = from + AT_LEAST + line;
      out.push(text.slice(from, end));
      from = end + 1;
    } else if (text.length - from >= AT_MOST) {
      const space = window.lastIndexOf(" ");
      const end = space >= 0 ? from + AT_LEAST + space + 1 : from + AT_MOST;
      out.push(text.slice(from, end));
      from = end;
    } else {
      out.push(text.slice(from));
      return out;
    }
  }
}
