import { For } from "solid-js";
import type { Example } from "../core/examples";
import { autoLayout } from "../layout/place";
import { toSVG } from "../render/svg";
import { Menu, MenuItem } from "./Menu";

const GROUPS = ["Typed", "Directions only", "Untyped"] as const;
type Group = (typeof GROUPS)[number];

function groupOf(ex: Example): Group {
  const { dirs, types } = ex.system().typing;
  return types !== "off" ? "Typed" : dirs !== "off" ? "Directions only" : "Untyped";
}

/** A miniature of the example's initial net, using the same layout as the canvas. */
function ExampleThumbnail(props: { ex: Example }) {
  const sys = props.ex.system();
  const net = props.ex.net(sys);
  const layout = autoLayout(net);
  const svg = toSVG(net, sys, layout.placement, layout.routed, { paper: "var(--paper)", ink: "var(--ink)" }, 12);
  return <span class="example-thumb" aria-hidden="true" innerHTML={svg} />;
}

export function ExamplesMenu(props: { examples: Example[]; onPick: (ex: Example) => void }) {
  const grouped = () => GROUPS.map((name) => ({ name, examples: props.examples.filter((ex) => groupOf(ex) === name) })).filter((group) => group.examples.length);

  return (
    <Menu label="Examples" title="Load an example net" menuClass="examples-menu">
      {(close) => (
        <>
          <div class="menu-head">Loading an example replaces the whole net. You can undo it.</div>
          <For each={grouped()}>
            {(group) => (
              <>
                <div class="menu-head example-group">{group.name}</div>
                <For each={group.examples}>
                  {(ex) => (
                    <MenuItem
                      lead={<ExampleThumbnail ex={ex} />}
                      title={ex.name}
                      note={ex.about}
                      onClick={() => {
                        props.onPick(ex);
                        close();
                      }}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        </>
      )}
    </Menu>
  );
}
