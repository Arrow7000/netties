/** Reproduce the native-reflection feasibility experiments without UI automation. */
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "research/native-reflection/results.json");
const temporary = await mkdtemp(join(tmpdir(), "netties-native-reflection-"));
try {
  const outfile = join(temporary, "experiments.mjs");
  await build({ entryPoints: [resolve(root, "research/native-reflection/experiments.ts")],
    outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { runExperiments } = await import(pathToFileURL(outfile).href);
  const result = `${JSON.stringify(runExperiments(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (await readFile(destination, "utf8") !== result) throw new Error("Recorded reflection results are stale; run npm run research:reflection -- --write");
    process.stdout.write("Native-reflection results reproduce exactly.\n");
  } else if (process.argv.includes("--write")) {
    await writeFile(destination, result);
    process.stdout.write(`Wrote ${destination}\n`);
  } else process.stdout.write(result);
} finally { await rm(temporary, { recursive: true, force: true }); }
