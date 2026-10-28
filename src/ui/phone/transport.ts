/**
 * The phone's Step, Parallel step and Run buttons, as a state machine in the
 * canvas's style (src/ui/gesture.ts). A quick tap fires straight away. A
 * hold arms the button instead: it stays pressed, the sheet says what it
 * would do (and Step and Parallel step show it on the canvas), and a quick tap
 * on it then fires it. A tap anywhere else lets it go. Sliding off a button
 * before letting go does nothing.
 *
 *   idle ──down──▶ pressing ──up──▶ idle (fired)
 *   pressing ──hold──▶ pressing, armed ──up──▶ armed
 *   armed ──tap on it──▶ idle (fired)
 *   armed ──elsewhere──▶ idle
 */
export type RunButton = "step" | "all" | "run";

export interface Transport {
  /** The button a hold armed. */
  armed?: RunButton;
  /** A pointer on a button; `inside`, still over it; `held`, the hold has armed it. */
  press?: { button: RunButton; pointer: number; inside: boolean; held: boolean };
}

export type TransportMsg =
  /** `holdable`: whether a hold would arm it (Run can't be armed while it runs). */
  | { kind: "down"; button: RunButton; pointer: number; holdable: boolean }
  | { kind: "hold"; pointer: number }
  /** The pointer has gone off its button, or back on. */
  | { kind: "slide"; pointer: number; inside: boolean }
  | { kind: "up"; pointer: number }
  | { kind: "cancel"; pointer: number }
  /** A tap anywhere but the armed button, or the button can't fire any more. */
  | { kind: "elsewhere" };

export type TransportEffect = { kind: "await-hold"; pointer: number } | { kind: "held" } | { kind: "fire"; button: RunButton };

type Out = [Transport, TransportEffect[]];

export function updateTransport(s: Transport, msg: TransportMsg): Out {
  switch (msg.kind) {
    case "down": {
      if (s.press) return [s, []];
      const press = { button: msg.button, pointer: msg.pointer, inside: true, held: false };
      return [{ ...s, press }, msg.holdable ? [{ kind: "await-hold", pointer: msg.pointer }] : []];
    }
    case "hold": {
      const p = s.press;
      if (!p || p.pointer !== msg.pointer || !p.inside || p.held) return [s, []];
      return [{ armed: p.button, press: { ...p, held: true } }, [{ kind: "held" }]];
    }
    case "slide": {
      const p = s.press;
      if (!p || p.pointer !== msg.pointer) return [s, []];
      return [{ ...s, press: { ...p, inside: msg.inside } }, []];
    }
    case "up": {
      const p = s.press;
      if (!p || p.pointer !== msg.pointer) return [s, []];
      if (!p.inside) return [{ armed: s.armed }, []];
      if (p.held) return [{ armed: s.armed }, []];
      return [{}, [{ kind: "fire", button: p.button }]];
    }
    case "cancel":
      return s.press?.pointer === msg.pointer ? [{ armed: s.armed }, []] : [s, []];
    case "elsewhere":
      return s.armed ? [{ press: s.press }, []] : [s, []];
  }
}
