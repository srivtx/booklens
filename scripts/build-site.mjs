import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = resolve(repoRoot, "src", "index.ts");
const shim = resolve(repoRoot, "site", "assets", "shims", "linkedom.mjs");
const outfile = resolve(repoRoot, "site", "assets", "demo.js");

async function main() {
  if (!existsSync(entry)) {
    process.stdout.write(
      `skipping booklens: ${entry} not found (nothing to bundle)\n`,
    );
    return;
  }

  if (!existsSync(shim)) {
    process.stdout.write(
      `skipping booklens: browser shim ${shim} not found\n`,
    );
    return;
  }

  await mkdir(dirname(outfile), { recursive: true });

  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    globalName: "BookLens",
    alias: { linkedom: shim },
    logLevel: "info",
  });

  process.stdout.write("built booklens -> site/assets/demo.js\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
