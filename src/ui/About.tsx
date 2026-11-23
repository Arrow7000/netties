import { onMount } from "solid-js";
import { CREDITS, REPO } from "./credits";
import { closeOnEscape } from "./dismiss";

/**
 * What netties is and whose ideas it's built on, as a small modal. Escape or
 * a click outside closes it. It's a real modal dialog, so focus stays in it
 * and goes back to where it was afterwards.
 */
export function AboutDialog(props: { onClose: () => void }) {
  let el!: HTMLDialogElement;
  closeOnEscape(props.onClose);
  onMount(() => {
    el.showModal();
    el.focus();
  });

  return (
    <dialog
      ref={el}
      class="about"
      tabIndex={-1}
      aria-labelledby="about-name"
      // Its own box is all `about-body`, so only the backdrop hits the dialog itself.
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      onClose={() => props.onClose()}
    >
      <div class="about-body">
        <svg class="about-mark" viewBox="-12 -14 24 28" aria-hidden="true">
          <polygon points="-9,-13 9,-13 0,-2" class="brand-filled" />
          <polygon points="-9,13 9,13 0,2" class="brand-hollow" />
        </svg>
        <h2 id="about-name">netties</h2>
        <p class="about-tagline">A playground for interaction nets</p>
        <dl>
          <dt>Interaction nets</dt>
          <dd>
            Yves Lafont, <Out href={CREDITS.nets}>1990</Out>
          </dd>
          <dt>Combinators</dt>
          <dd>
            Yves Lafont, <Out href={CREDITS.combinators}>1997</Out>
          </dd>
          <dt>Calculus</dt>
          <dd>
            Maribel Fernández and Ian Mackie, <Out href={CREDITS.calculus}>1999</Out>
          </dd>
          <dt>Text notation</dt>
          <dd>
            Based on <Out href={CREDITS.pin}>Pin</Out> by Abubakar Hassan, Ian Mackie and Shinya Sato, and{" "}
            <Out href={CREDITS.inpla}>Inpla</Out> by Shinya Sato
          </dd>
        </dl>
        <a class="btn about-source" href={REPO} target="_blank" rel="noopener">
          Source on GitHub
        </a>
        <p class="about-foot">
          <Out href={`${REPO}/blob/main/LICENSE`}>PolyForm Noncommercial License</Out>
          <br />© 2026 Aron Adler
        </p>
      </div>
    </dialog>
  );
}

/** A link out of the app, in a new tab. */
export function Out(props: { href: string; children: string }) {
  return (
    <a class="out" href={props.href} target="_blank" rel="noopener">
      {props.children}
    </a>
  );
}
