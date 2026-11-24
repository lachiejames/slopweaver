/**
 * The `PreToolUse` bundle generation's front door: prove the generation still matches every file it was built
 * from, then run it — or exit 75 without importing a byte of the gate, so the shim runs `tsx` over the live
 * source instead (`scripts/pretooluse.sh`).
 *
 * This file only ever runs BUNDLED, as `<root>/.hook-build/generation-<id>/launch.mjs`, built beside the gate's
 * own `entry.mjs` by `hooks/pretooluseBuild.ts`; its root is two directories up from its own URL, which is
 * true of nowhere else. It reads the manifest beside it, stats every input relative to that root, and imports
 * `entry.mjs` only on an exact match (`src/admit/hookBundleManifest.ts` § hookBundleFreshness). Anything
 * unreadable is a miss, never a verdict: 75 is a code no gate exits, so the shim can tell it apart from one.
 *
 * Once the entry is imported the gate owns the process and its exit code, exactly as under `tsx`, fail-closed
 * handler included. The gate exits only 0 or 2 by its own hand, so the shim returns only those and re-runs the call
 * on `tsx` on any other status: this file's 75, or a process that died before a gate decided (a chunk of this
 * launcher gone, so node never linked it, or a kill that was not the budget's).
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  type HookBundleStampReader,
  hookBundleFreshness,
  hookBundleInputStamp,
  parseHookBundleManifest,
} from "../src/admit/hookBundleManifest.js";

/** The exit code that means "this generation cannot answer; run the live source". */
const MISS = 75;

const generation = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(generation));

/**
 * The manifest beside this launcher, or undefined when it cannot be read.
 *
 * @returns its text, or undefined
 */
function manifestText(): string | undefined {
  try {
    return readFileSync(join(generation, "manifest.json"), "utf8");
  } catch {
    return undefined;
  }
}

/** One input's stamp now, or undefined when it is gone or unreadable. */
const readStamp: HookBundleStampReader = (path) => {
  try {
    return hookBundleInputStamp({ path, stats: statSync(join(root, path), { bigint: true }) });
  } catch {
    return undefined;
  }
};

const text = manifestText();
const manifest = text === undefined ? undefined : parseHookBundleManifest({ text });
const fresh =
  manifest !== undefined &&
  manifest.isOk() &&
  hookBundleFreshness({ manifest: manifest.value, readStamp }).kind === "fresh";
if (fresh) {
  try {
    // A computed specifier, so esbuild leaves it to node: `entry.mjs` is the build's OTHER output, never a source file.
    await import(pathToFileURL(join(generation, "entry.mjs")).href);
  } catch {
    // The entry did not LINK (a chunk gone from under it, say), so the gate never ran and has said nothing: the
    // live source decides instead. Node would otherwise exit 1 here, which the harness reads as no block at all.
    process.exitCode = MISS;
  }
} else {
  process.exitCode = MISS;
}
