/**
 * The manifest a prebuilt `PreToolUse` bundle generation carries, and the rule that decides whether it may run.
 *
 * A generation (`<root>/.hook-build/generation-*`) is an esbuild code-split build of `hooks/pretooluse.ts`. It
 * may answer a tool call only while every file the build READ is byte-for-byte the file it read, and the
 * manifest is how a launcher proves that without reading a byte of source: one `stat` per input, compared
 * field by field against the stamp taken when the build ran. A stamp is the device, inode, mode, size and the
 * nanosecond mtime AND ctime, so a write that keeps the size and restores the mtime still moves the ctime, and
 * a tree copied or moved elsewhere moves the inode. One differing field is a miss, never a guess.
 *
 * The generation's OWN files are stamped the same way (`outputs`), because an `entry.mjs` truncated to nothing
 * imports cleanly and exits 0 having run no gate at all; stamped, it is a miss and the live source answers.
 * The two lists stay apart because only the inputs are held to the build's start instant.
 *
 * MEASURED on this tree: the 2,332 inputs of the gate's whole graph parse and stat in 17 ms in one node
 * process, against the 569–712 ms one `tsx hooks/pretooluse.ts` boot costs at a load of 6–9. Repro, from a
 * root holding a current generation:
 *
 *   node -e 'const fs=require("fs"),b=".hook-build/";const t=performance.now();const m=JSON.parse(fs.readFileSync(b+fs.readFileSync(b+"current","utf8").trim()+"/manifest.json"));for(const i of m.inputs)fs.statSync(i.path,{bigint:true});console.log(m.inputs.length,performance.now()-t)'
 *
 * Pure: the launcher (`hooks/pretooluseLaunch.ts`) and the builder (`hooks/pretooluseBuild.ts`) own the I/O
 * and hand this module plain values and a stat seam. Kept free of zod and of every other module in the hook's
 * closure, because the launcher imports it before it knows whether the generation may run at all.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type HookBundleError, HookBundleErrors } from "./hookBundleErrors.js";

/** The one manifest version this module writes and reads; any other is a miss. */
export const HOOK_BUNDLE_MANIFEST_FORMAT = "slopweaver-pretooluse-bundle-v2";

/** One input's identity at build time. Every field is a decimal string, because `bigint` does not survive JSON. */
export interface HookBundleInputStamp {
  readonly path: string;
  readonly device: string;
  readonly inode: string;
  readonly mode: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly ctimeNs: string;
}

/** What a generation's `manifest.json` holds. */
export interface HookBundleManifest {
  readonly format: typeof HOOK_BUNDLE_MANIFEST_FORMAT;
  /** Every source file the build read, plus the files that decide how its bare imports resolve. */
  readonly inputs: readonly HookBundleInputStamp[];
  /** Every file the build wrote into the generation, the manifest itself excepted. */
  readonly outputs: readonly HookBundleInputStamp[];
}

/** Whether a generation may answer, and when it may not, the first input that says so. */
export type HookBundleFreshness =
  { readonly kind: "fresh" } | { readonly kind: "stale"; readonly path: string; readonly reason: string };

const STAMP_FIELDS = ["device", "inode", "mode", "size", "mtimeNs", "ctimeNs"] as const;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/**
 * Whether a path is one a root-relative stamp can name: relative, non-empty, no `.` or `..` segment.
 *
 * @returns true when the path names a file inside the root
 */
function isRootRelative({ path }: { path: string }): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The stamp of one input, from a `stat(…, { bigint: true })` result.
 *
 * @param stats the bigint fields `fs.statSync(path, { bigint: true })` returns
 * @returns the stamp, every field a decimal string
 */
export function hookBundleInputStamp({
  path,
  stats,
}: {
  path: string;
  stats: {
    readonly dev: bigint;
    readonly ino: bigint;
    readonly mode: bigint;
    readonly size: bigint;
    readonly mtimeNs: bigint;
    readonly ctimeNs: bigint;
  };
}): HookBundleInputStamp {
  return {
    ctimeNs: stats.ctimeNs.toString(),
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    mode: stats.mode.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    path,
    size: stats.size.toString(),
  };
}

/**
 * Every file a build read, from its esbuild metafile, plus the files that steer resolution without being
 * imported (the manifests and the compiler config), sorted and without repeats.
 *
 * @param metafile the parsed esbuild metafile of a build run with `absWorkingDir` at the source root
 * @param extra root-relative files to stamp whether or not the build imported them
 * @returns the root-relative input paths, or why the metafile cannot vouch for a build
 */
export function hookBundleInputPaths({
  metafile,
  extra,
}: {
  metafile: unknown;
  extra: readonly string[];
}): Result<readonly string[], HookBundleError> {
  if (typeof metafile !== "object" || metafile === null || !("inputs" in metafile)) {
    return err(HookBundleErrors.metafileMalformed({ detail: "no inputs object" }));
  }
  const inputs = metafile.inputs;
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
    return err(HookBundleErrors.metafileMalformed({ detail: "inputs is not an object" }));
  }
  const read = Object.keys(inputs);
  if (read.length === 0) {
    return err(HookBundleErrors.noInputs());
  }
  const paths = [...new Set([...read, ...extra])].toSorted();
  const outside = paths.find((path) => !isRootRelative({ path }));
  if (outside !== undefined) {
    return err(HookBundleErrors.inputOutsideRoot({ path: outside }));
  }
  return ok(paths);
}

/**
 * The first input whose inode changed at or after the build began, or none.
 *
 * The builder stamps every input AFTER esbuild has read it, so a file saved mid-build could land in the bundle
 * in one state and in the manifest in another, and the generation would vouch for bytes it never ran. A ctime
 * is set by the kernel to the current time on every write, rename or chmod and cannot be set back, so an
 * input whose ctime is not strictly before the build's start instant (the ctime of a marker the builder wrote
 * first, on the same clock) may have changed under the build, and the build is not published.
 *
 * @param inputs every input's stamp, taken once the build finished
 * @param sinceCtimeNs the build's start instant, as a filesystem ctime in nanoseconds
 * @returns the first such path, or undefined when every input predates the build
 */
export function firstInputChangedSince({
  inputs,
  sinceCtimeNs,
}: {
  inputs: readonly HookBundleInputStamp[];
  sinceCtimeNs: string;
}): string | undefined {
  const since = BigInt(sinceCtimeNs);
  return inputs.find((input) => BigInt(input.ctimeNs) >= since)?.path;
}

/**
 * The manifest a generation is published with.
 *
 * @param inputs every input's stamp, already proven stable across the build
 * @param outputs every file the build wrote into the generation, stamped where it will be served from
 * @returns the manifest, or why it would vouch for nothing
 */
export function hookBundleManifest({
  inputs,
  outputs,
}: {
  inputs: readonly HookBundleInputStamp[];
  outputs: readonly HookBundleInputStamp[];
}): Result<HookBundleManifest, HookBundleError> {
  if (inputs.length === 0) {
    return err(HookBundleErrors.noInputs());
  }
  if (outputs.length === 0) {
    return err(HookBundleErrors.noOutputs());
  }
  return ok({ format: HOOK_BUNDLE_MANIFEST_FORMAT, inputs, outputs });
}

/**
 * One stamp read back from a manifest, or why it is not one.
 *
 * @returns the stamp, or the malformed-manifest error naming what refused it
 */
function parseStamp({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): Result<HookBundleInputStamp, HookBundleError> {
  if (!isRecord(value)) {
    return err(HookBundleErrors.manifestMalformed({ detail: `input ${String(index)} is not an object` }));
  }
  const path = value["path"];
  if (typeof path !== "string" || !isRootRelative({ path })) {
    return err(HookBundleErrors.manifestMalformed({ detail: `input ${String(index)} has no root-relative path` }));
  }
  const decimals: Partial<Record<(typeof STAMP_FIELDS)[number], string>> = {};
  for (const field of STAMP_FIELDS) {
    const raw = value[field];
    if (typeof raw !== "string" || !DECIMAL.test(raw)) {
      return err(HookBundleErrors.manifestMalformed({ detail: `input ${path} has no decimal ${field}` }));
    }
    decimals[field] = raw;
  }
  // Invariant: the loop above returned unless every stamp field was read as a decimal string.
  return ok({
    ctimeNs: decimals.ctimeNs!,
    device: decimals.device!,
    inode: decimals.inode!,
    mode: decimals.mode!,
    mtimeNs: decimals.mtimeNs!,
    path,
    size: decimals.size!,
  });
}

/**
 * A manifest read back from disk, refused unless it is exactly the shape this version writes.
 *
 * @param text the file's contents
 * @returns the manifest, or why it is not one
 */
export function parseHookBundleManifest({ text }: { text: string }): Result<HookBundleManifest, HookBundleError> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err(HookBundleErrors.manifestMalformed({ detail: "not JSON" }));
  }
  if (!isRecord(value)) {
    return err(HookBundleErrors.manifestMalformed({ detail: "not an object" }));
  }
  if (value["format"] !== HOOK_BUNDLE_MANIFEST_FORMAT) {
    return err(HookBundleErrors.manifestMalformed({ detail: "unknown format" }));
  }
  const seen = new Set<string>();
  return parseStampList({ raw: value["inputs"], seen, side: "inputs" }).andThen((inputs) =>
    parseStampList({ raw: value["outputs"], seen, side: "outputs" }).map((outputs): HookBundleManifest => ({
      format: HOOK_BUNDLE_MANIFEST_FORMAT,
      inputs,
      outputs,
    })),
  );
}

/**
 * One non-empty list of stamps read back from a manifest, refusing a path any earlier list already named.
 *
 * @param raw the list's value as parsed, of unknown shape
 * @param seen every path read so far across both lists, extended in place
 * @param side which list this is, named in a refusal
 * @returns the stamps, or why the list is not one
 */
function parseStampList({
  raw,
  seen,
  side,
}: {
  raw: unknown;
  seen: Set<string>;
  side: "inputs" | "outputs";
}): Result<readonly HookBundleInputStamp[], HookBundleError> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return err(HookBundleErrors.manifestMalformed({ detail: `no ${side}` }));
  }
  const stamps: HookBundleInputStamp[] = [];
  for (const [index, entry] of raw.entries()) {
    const stamp = parseStamp({ index, value: entry });
    if (stamp.isErr()) {
      return err(stamp.error);
    }
    if (seen.has(stamp.value.path)) {
      return err(HookBundleErrors.manifestMalformed({ detail: `${stamp.value.path} is listed twice` }));
    }
    seen.add(stamp.value.path);
    stamps.push(stamp.value);
  }
  return ok(stamps);
}

/** Stats one root-relative file now, answering undefined when it is gone or unreadable. */
export type HookBundleStampReader = (path: string) => HookBundleInputStamp | undefined;

/**
 * Whether a generation may answer: every input and every output stamped at build time must stat to the identical
 * stamp now.
 *
 * Stops at the first difference, inputs first, so a stale generation costs the launcher only as many stats as it
 * takes to find one changed file.
 *
 * @param manifest the generation's manifest
 * @param readStamp stats one root-relative input now, answering undefined when it is gone or unreadable
 * @returns fresh, or the first input that makes the generation stale and why
 */
export function hookBundleFreshness({
  manifest,
  readStamp,
}: {
  manifest: HookBundleManifest;
  readStamp: HookBundleStampReader;
}): HookBundleFreshness {
  for (const recorded of [...manifest.inputs, ...manifest.outputs]) {
    const now = readStamp(recorded.path);
    if (now === undefined) {
      return { kind: "stale", path: recorded.path, reason: "gone or unreadable" };
    }
    const moved = STAMP_FIELDS.find((field) => now[field] !== recorded[field]);
    if (moved !== undefined) {
      return { kind: "stale", path: recorded.path, reason: `${moved} changed` };
    }
  }
  return { kind: "fresh" };
}
