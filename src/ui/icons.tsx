import type { JSX } from "solid-js";

/** Small line icons, drawn on a 16-unit grid in the current text colour. */
const icon = (body: () => JSX.Element) => () => (
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    {body()}
  </svg>
);

const line = { fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

export const Chevron = icon(() => <path d="M4 6l4 4 4-4" {...line} />);
export const Undo = icon(() => <path d="M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8" {...line} />);
export const Redo = icon(() => <path d="M10 4l3 3-3 3M12.5 7H6a3 3 0 000 6h2" {...line} />);
export const Theme = icon(() =>
  <>
    <circle cx="8" cy="8" r="5.5" {...line} stroke-width={1.4} />
    <path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor" />
  </>,
);
export const Step = icon(() =>
  <>
    <path d="M4 3.5l6 4.5-6 4.5z" fill="currentColor" />
    <path d="M12 3.5v9" {...line} stroke-width={1.6} />
  </>,
);
export const StepAll = icon(() => <path d="M2 3.5l5 4.5-5 4.5zM8 3.5l5 4.5-5 4.5z" fill="currentColor" />);
export const Play = icon(() => <path d="M4.5 3l8 5-8 5z" fill="currentColor" />);
export const Stop = icon(() => <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />);
export const Slow = icon(() =>
  <>
    <circle cx="8" cy="8.5" r="5.5" {...line} stroke-width={1.4} />
    <path d="M8 5.5v3l2 1.5M6.5 1.8h3" {...line} stroke-width={1.4} />
  </>,
);
export const Minus = icon(() => <path d="M3.5 8h9" {...line} />);
export const Plus = icon(() => <path d="M3.5 8h9M8 3.5v9" {...line} />);
export const Fit = icon(() => <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" {...line} stroke-width={1.4} />);
export const Pencil = icon(() => <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" {...line} stroke-width={1.3} />);
export const Trash = icon(() => <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" {...line} stroke-width={1.3} />);
export const Expand = icon(() => <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" {...line} stroke-width={1.4} />);
export const Close = icon(() => <path d="M4 4l8 8M12 4l-8 8" {...line} />);
export const Component = icon(() =>
  <>
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" {...line} stroke-width={1.3} stroke-dasharray="2 1.5" />
    <path d="M8 6v4M6 8h4" {...line} stroke-width={1.3} />
  </>,
);
export const Eye = icon(() =>
  <>
    <path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z" {...line} stroke-width={1.3} />
    <circle cx="8" cy="8" r="1.9" {...line} stroke-width={1.3} />
  </>,
);
export const Copy = icon(() =>
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" {...line} stroke-width={1.3} />
    <path d="M10.5 5.5V4.3a1.8 1.8 0 00-1.8-1.8H4.3a1.8 1.8 0 00-1.8 1.8v4.4a1.8 1.8 0 001.8 1.8h1.2" {...line} stroke-width={1.3} />
  </>,
);
export const Check = icon(() => <path d="M3.5 8.5l3 3 6-7" {...line} />);
export const Left = icon(() => <path d="M10 4L6 8l4 4" {...line} />);
export const Right = icon(() => <path d="M6 4l4 4-4 4" {...line} />);
/** Tidy: three rows lined up. */
export const Tidy = icon(() => <path d="M3 4h10M5 8h6M4 12h8" {...line} />);
/** Reset: an arrow going back round. */
export const Reset = icon(() =>
  <>
    <path d="M2.5 8a5.5 5.5 0 105.5-5.5 6 6 0 00-4.1 1.7L2.5 5.6" {...line} stroke-width={1.4} />
    <path d="M2.5 2.5v3.1h3.1" {...line} stroke-width={1.4} />
  </>,
);
/** Settings for the view: two sliders. */
export const Sliders = icon(() =>
  <>
    <path d="M2.5 5h6M12 5h1.5M2.5 11h1.5M8 11h5.5" {...line} stroke-width={1.4} />
    <circle cx="10.2" cy="5" r="1.7" {...line} stroke-width={1.4} />
    <circle cx="5.8" cy="11" r="1.7" {...line} stroke-width={1.4} />
  </>,
);
