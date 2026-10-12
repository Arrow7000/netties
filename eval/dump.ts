import { examples } from "../src/core/examples";
import { print } from "../src/core/text";
for (const e of examples) {
  const sys = e.system();
  console.log(`===== ${e.name} — ${e.about}`);
  console.log(print(sys, e.net(sys)));
}
