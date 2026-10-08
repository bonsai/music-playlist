import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Bundles a TypeScript source file and imports the result as an ES module. */
export async function importTs(entry, name) {
  const outDir = mkdtempSync(path.join(tmpdir(), `rs-${name}-`));
  const outfile = path.join(outDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

/** Locates a Playwright-managed Chromium, whatever revision is cached. */
export function findChromium() {
  const base = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
  const dir = readdirSync(base)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .pop();
  if (!dir) throw new Error(`no chromium under ${base}`);
  const exe = path.join(base, dir, "chrome-linux64", "chrome");
  if (!existsSync(exe)) throw new Error(`missing ${exe}`);
  return exe;
}