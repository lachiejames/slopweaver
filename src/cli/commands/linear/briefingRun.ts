/**
 * `slopweaver linear briefing build` — the effectful shell. It reads one briefing, validates it, checks its
 * `evidenceSinceIso` against the floor the sibling bundles' `applied-all.json` records derive, and writes the
 * bundle `./briefingCore.ts` plans into `--out`. It reaches no provider: every write the briefing proposes is
 * sent later, only on their yes, by the `slopweaver linear` verb its printed command names
 * (`skills/automation/reference/linear-briefing.md`).
 */
import { type Dirent, existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  briefingBundleWrites,
  briefingReportJson,
  briefingReportLines,
  type LinearBriefingArgs,
  type LinearBriefingBuild,
  parseLinearBriefingArgs,
  parseLinearBriefingForm,
  staleFormNames,
} from "./briefingCore.js";
import {
  APPLIED_ALL_FILE,
  appliedRecordVerdict,
  briefingFloor,
  floorRefusal,
  heldSinceFloor,
} from "./briefingFloor.js";
import { LINEAR_BRIEFING_USAGE } from "./briefingUsage.js";
import { linearVerbErrorLines } from "./errors.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions and a temp directory; nothing here is a mock. */
export interface LinearBriefingDeps {
  readonly readForm: (args: { source: string }) => string;
  readonly cwd: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag
 */
export function productionLinearBriefingDeps(): LinearBriefingDeps {
  return {
    cwd: () => process.cwd(),
    err: (line) => process.stderr.write(`linear briefing: ${line}\n`),
    out: (line) => {
      logger.out({ line });
    },
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
  };
}

/**
 * The numbered forms already in `forms/`, or none when it does not exist yet. Anything but a real directory there —
 * a symlink above all — throws, because removing stale forms and writing new ones through it would reach files
 * outside `--out`.
 */
function presentForms({ dir }: { dir: string }): readonly string[] {
  const stats = lstatSync(dir, { throwIfNoEntry: false });
  if (stats === undefined) {
    return [];
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `${dir} is not a plain directory (a symlink or a file stands there), so nothing is written through it`,
    );
  }
  return readdirSync(dir);
}

/**
 * A bundle file's text, or `undefined` when the bundle has none or it cannot be read (a directory in its place, a
 * permission). Never a throw: an unreadable briefing is NAMED by `heldSinceFloor`, and an unreadable record
 * certifies nothing, so its bundle is carried rather than lost to a crash.
 */
function bundleFileText({ path }: { path: string }): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Every file in a bundle's `forms/`, keyed `forms/<name>` as a step names it, with its text, or `undefined` when it
 * cannot be read — kept rather than dropped, so an unreadable form still counts as one the verdict must account for.
 * Never a throw: only a `forms/` with no entry at all is an empty listing. Anything standing there that cannot be
 * listed — a file, a dangling symlink, a permission — is `undefined`, so the bundle certifies nothing even when it
 * planned no form at all.
 */
function bundleFormTexts({ dir }: { dir: string }): Readonly<Record<string, string | undefined>> | undefined {
  let names: readonly string[];
  try {
    names = lstatSync(dir, { throwIfNoEntry: false }) === undefined ? [] : readdirSync(dir);
  } catch {
    return undefined;
  }
  return Object.fromEntries(names.map((name) => [`forms/${name}`, bundleFileText({ path: join(dir, name) })]));
}

/**
 * Whether a root entry is a bundle: a directory, or a link to one. A link that resolves to nothing is a bundle too,
 * so it is named as unreadable rather than silently dropped; only a plain file (a note beside the bundles) is not.
 */
function isBundleEntry({ entry, root }: { entry: Dirent; root: string }): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return statSync(join(root, entry.name)).isDirectory();
  } catch {
    return true;
  }
}

/** A directory's filesystem identity, or `undefined` when nothing is there yet or it cannot be read. */
function directoryIdentity({ path }: { path: string }): string | undefined {
  try {
    const stats = statSync(path);
    return `${String(stats.dev)}:${String(stats.ino)}`;
  } catch {
    return undefined;
  }
}

/**
 * Whether a root entry IS the bundle being built: by name, or by filesystem identity, so a differently cased `--out`
 * on a case-insensitive volume, or a link to it, never makes this bundle's own old record its own floor.
 */
function isOutDir({
  entry,
  outDir,
  root,
  self,
}: {
  entry: Dirent;
  outDir: string;
  root: string;
  self: string | undefined;
}): boolean {
  if (entry.name === basename(outDir)) {
    return true;
  }
  return self !== undefined && directoryIdentity({ path: join(root, entry.name) }) === self;
}

/**
 * Every sibling bundle with its record, if any, and the two files it is judged against; this bundle's own record
 * is never its own floor.
 */
function siblingBundles({ outDir }: { outDir: string }): readonly {
  name: string;
  path: string;
  applied: string | undefined;
  apply: string | undefined;
  briefing: string | undefined;
  dir: string;
  forms: Readonly<Record<string, string | undefined>> | undefined;
}[] {
  const root = dirname(outDir);
  // No root yet is the FIRST briefing ever: no siblings, so a null floor and the whole corpus read, by design.
  // A root that exists but cannot be listed throws, and the caller refuses the build. What this cannot close: a
  // root that lists fine but hides an entry (a permission on one sibling's directory reads as an unreadable
  // bundle, named; a sibling deleted by hand is gone). Nothing here reaches a provider to cross-check it.
  if (!existsSync(root)) {
    return [];
  }
  const self = directoryIdentity({ path: outDir });
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => !isOutDir({ entry, outDir, root, self }) && isBundleEntry({ entry, root }))
    .map((entry) => ({
      applied: bundleFileText({ path: join(root, entry.name, APPLIED_ALL_FILE) }),
      apply: bundleFileText({ path: join(root, entry.name, "apply.json") }),
      briefing: bundleFileText({ path: join(root, entry.name, "briefing.json") }),
      dir: join(root, entry.name),
      forms: bundleFormTexts({ dir: join(root, entry.name, "forms") }),
      name: entry.name,
      path: join(root, entry.name, APPLIED_ALL_FILE),
    }));
}

/** A caught throw's own message, whatever was thrown. */
function thrownMessage({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Split the siblings into the `asOfIso` of each one whose record certifies a full apply, and every other bundle,
 * which the floor carries. A record that certifies nothing is named on `err` with its problems.
 */
function partitionSiblings({
  siblings,
  err,
}: {
  siblings: ReturnType<typeof siblingBundles>;
  err: (line: string) => void;
}): { applied: readonly string[]; unapplied: readonly { name: string; briefing: string | undefined }[] } {
  const applied: string[] = [];
  const unapplied: { name: string; briefing: string | undefined }[] = [];
  for (const bundle of siblings) {
    if (bundle.applied === undefined) {
      unapplied.push({ briefing: bundle.briefing, name: bundle.name });
      continue;
    }
    const verdict = appliedRecordVerdict({
      applied: bundle.applied,
      apply: bundle.apply,
      briefing: bundle.briefing,
      bundleDir: bundle.dir,
      forms: bundle.forms,
    });
    if (verdict.kind === "applied") {
      applied.push(verdict.asOfIso);
      continue;
    }
    err(`ignored ${bundle.path}: it does not certify a full apply, so that briefing never moves the floor —`);
    for (const problem of verdict.problems) {
      err(`  ${problem}`);
    }
    unapplied.push({ briefing: bundle.briefing, name: bundle.name });
  }
  return { applied, unapplied };
}

/** Print a refusal past the floor, still naming what the next briefing must re-read, and return its code. */
function refuseCarrying({
  carried,
  code,
  deps,
  lines,
}: {
  carried: readonly string[];
  code: number;
  deps: LinearBriefingDeps;
  lines: readonly string[];
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  if (carried.length > 0) {
    deps.err(`unapplied since that floor, so re-read: ${carried.join(", ")}`);
  }
  return code;
}

/** Remove the forms this build no longer carries, then write every file it plans; a throw is the caller's. */
function writeBundleFiles({ build, outDir }: { build: LinearBriefingBuild; outDir: string }): readonly string[] {
  const formsDir = join(outDir, "forms");
  const removed = staleFormNames({ keep: build.formNames, present: presentForms({ dir: formsDir }) });
  for (const name of removed) {
    rmSync(join(formsDir, name), { force: true });
  }
  for (const write of build.writes) {
    writeFileAtomic({ contents: write.contents, path: write.path });
  }
  return removed;
}

/** Read, validate and write one briefing against an already-derived floor, then report the bundle. */
function buildAgainstFloor({
  args,
  carried,
  deps,
  floor,
}: {
  args: LinearBriefingArgs;
  carried: readonly string[];
  deps: LinearBriefingDeps;
  floor: string | null;
}): number {
  let raw: string;
  try {
    raw = deps.readForm({ source: args.formSource });
  } catch (error: unknown) {
    return refuseCarrying({
      carried,
      code: EXIT_ERROR,
      deps,
      lines: [`could not read the briefing: ${thrownMessage({ error })}`],
    });
  }
  const form = parseLinearBriefingForm({ raw });
  if (form.isErr()) {
    return refuseCarrying({ carried, code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  const refusal = floorRefusal({ floor, form: form.value });
  if (refusal !== undefined) {
    return refuseCarrying({ carried, code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: refusal }) });
  }
  const build = briefingBundleWrites({ form: form.value, outDir: args.outDir });
  let removed: readonly string[];
  try {
    removed = writeBundleFiles({ build, outDir: args.outDir });
  } catch (error: unknown) {
    return refuseCarrying({
      carried,
      code: EXIT_ERROR,
      deps,
      lines: [`could not write the bundle at ${args.outDir}: ${thrownMessage({ error })}`],
    });
  }
  if (args.json) {
    deps.out(briefingReportJson({ build, carried, outDir: args.outDir, removed }));
    return EXIT_OK;
  }
  for (const line of briefingReportLines({ build, carried, outDir: args.outDir, removed })) {
    deps.out(line);
  }
  return EXIT_OK;
}

/**
 * Run `linear briefing build`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runLinearBriefing({ argv, deps }: { argv: readonly string[]; deps: LinearBriefingDeps }): number {
  const parsed = parseLinearBriefingArgs({ argv: argv.slice(VERB_ARG_OFFSET), cwd: deps.cwd() });
  if (parsed.isErr()) {
    for (const line of [...linearVerbErrorLines({ error: parsed.error }), LINEAR_BRIEFING_USAGE]) {
      deps.err(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  let siblings: ReturnType<typeof siblingBundles>;
  try {
    siblings = siblingBundles({ outDir: args.outDir });
  } catch (error: unknown) {
    deps.err(
      `could not list the briefings beside ${args.outDir}, so the floor is unknown and nothing is built: ` +
        thrownMessage({ error }),
    );
    return EXIT_ERROR;
  }
  const { applied, unapplied } = partitionSiblings({ err: deps.err, siblings });
  const floor = briefingFloor({ applied });
  return buildAgainstFloor({ args, carried: heldSinceFloor({ floor, unapplied }), deps, floor });
}

/** `slopweaver linear briefing` — validate one end-of-day Linear briefing and write its bundle. */
export const linearBriefingCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearBriefing({ argv, deps: productionLinearBriefingDeps() }),
});
