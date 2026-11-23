/**
 * `slopweaver handover close` and `slopweaver handover artifact` — the two verbs that let a row's own state
 * be RECORDED rather than asked for.
 *
 * ## The defect both of these close
 *
 * MEASURED: four fields on a board row had no writer at all — `status:`, `doneWhen:`, and the pair
 * `settlement:`/`ruling:` a verb writes once and can never correct. `status:` is the one that mattered most,
 * because the board PRINTED the instruction to hand-edit itself in five places: `handover list`'s own
 * `LOOKS SHIPPED` section said `confirm: set \`status: done\` in <path>`, `handover start` said it on a landed
 * doc, and `handover finish` said it twice. A renderer instructing a human to edit the file it just rendered
 * is the clearest statement of the defect — the verb knows exactly what should change and cannot change it.
 *
 * The state is derived, never kept as a second copy. So `close` does not
 * write `status: done`. It records a `closed` event, and `../../../handover/derivedRowState.ts` derives
 * `done` from it — on every reader, at once, with nothing to keep in step.
 *
 * ## Why `close` is not `finish`, and why it takes no run
 *
 * `finish` closes a RUN CYCLE: a session stopped, its probes were weighed, and whether the change is live is
 * a different question, asked later, when a pull request merges. `close` answers that question. So it is
 * deliberately usable on a row with NO cycle at all — the `LOOKS SHIPPED` case, where every declared probe
 * passes and nobody ever opened a run — which is exactly what `finish` correctly refuses and what the
 * hand-edit instruction existed to cover.
 *
 * ## Why `artifact` is a verb rather than a front-matter edit
 *
 * `../../../handover/frontmatter.ts`'s `addFrontMatterFields` is add-only and REFUSES a key the doc already
 * declares, so no code in this repository could CORRECT a row's artifact URL — a settled row kept pointing at
 * a dead witness for ever and every sweep re-flagged a page that had been repaired hours earlier. The
 * `artifact` event supersedes by append, so the pointer is fixable and every earlier value stays on the
 * journal.
 */

import { slopweaverHome } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { artifactUnderClosingLock, type ClosePrecondition, closeUnderClosingLock } from "./closeUnderLock.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { nowIso, VERB_ARG_OFFSET } from "./lifecycleRunCore.js";

/** The flags `handover close` accepts. */
const CLOSE_FLAGS: FlagSpec = { string: ["summary", "artifact", "dir", "home"] };

/** The flags `handover artifact` accepts. */
const ARTIFACT_FLAGS: FlagSpec = { string: ["url", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_CLOSE_FLAG_NAMES: readonly string[] = stringFlagsOf({ spec: CLOSE_FLAGS })
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_ARTIFACT_FLAG_NAMES: readonly string[] = stringFlagsOf({ spec: ARTIFACT_FLAGS })
  .map((name) => `--${name}`)
  .toSorted();

export const CLOSE_USAGE =
  "usage: slopweaver handover close <slug> --summary <what shipped> [--artifact <url>] " +
  "[--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Records that a row's WORK SHIPPED, in its journal, so every reader derives `done` without anyone\n" +
  "editing `status:`. Distinct from `handover finish`, which closes a RUN CYCLE before any pull request\n" +
  "has merged — `close` needs no open run and is the verb for a row whose probes already pass.\n" +
  "\n" +
  "--summary is required: a row that shipped with no account of what shipped is the `statusSummary:`\n" +
  "         nobody wrote, one register later.";

export const ARTIFACT_USAGE =
  "usage: slopweaver handover artifact <slug> --url <url> [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Records where this row's answer was published, superseding whatever was recorded before. Front-matter\n" +
  "cannot be corrected this way, because `addFrontMatterFields` refuses a key the doc already declares.\n" +
  "A `ruling` supersedes too, by the latest DECISION rather than by the last line written.";

/**
 * Parse `handover close` flags. Exported so the help-truth ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseHandoverCloseArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: CLOSE_FLAGS });
}

/**
 * Parse `handover artifact` flags. Exported so the help-truth ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseHandoverArtifactArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: ARTIFACT_FLAGS });
}

/** What one of these verbs resolved to: the row it names, and where its journal lives. */
interface RowTarget {
  readonly doc: HandoverDoc;
  readonly home: string;
  readonly runsDir: string;
}

/**
 * Find the row a verb was pointed at, or print why it could not be found.
 *
 * @param slug the slug the caller named
 * @param values the parsed flag values, for `--dir`/`--home` routing
 * @param verb the verb's own name, for the printed refusal
 * @returns the row and its runs directory, or the exit code to stop on
 */
function resolveRow({
  slug,
  values,
  verb,
}: {
  slug: string;
  values: Readonly<Record<string, unknown>>;
  verb: string;
}): RowTarget | number {
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const handoverDir = resolveHandoverDir({
    dir: typeof values["dir"] === "string" ? values["dir"] : undefined,
    home,
  });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover ${verb}: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const doc = scan.value.docs.find((candidate) => candidate.slug === slug);
  if (doc === undefined) {
    logger.error({ msg: `handover ${verb}: no row on the board claims the slug "${slug}"` });
    return EXIT_ERROR;
  }
  if (doc.problems.length > 0) {
    logger.error({ msg: `handover ${verb}: ${slug}'s front-matter does not parse cleanly, so nothing was written:` });
    doc.problems.forEach((problem) => {
      logger.error({ msg: `  - ${problem}` });
    });
    return EXIT_ERROR;
  }
  return { doc, home, runsDir: stateHomePaths({ home }).runs };
}

/**
 * Record that a row's work shipped.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverClose(argv: readonly string[]): Promise<number> {
  return closeRowInProcess({ argv, out: logger.out });
}

/**
 * Record that a row's work shipped, writing its receipt through `out` — the in-process half a caller with its own
 * stdout uses. `sweep board --close-shipped` closes rows this way, and under `--json` stdout is that verb's document,
 * so the receipt goes where the caller says. Refusals still go to stderr, which no caller owns.
 *
 * @param argv the full argv, `[node, cli, "handover", "close", …]`
 * @param out where the success receipt goes
 * @param precondition the caller's own refusal, asked under the row's closing lock as it is about to be written
 * @returns the verb's exit code
 */
export async function closeRowInProcess({
  argv,
  out,
  precondition,
}: {
  argv: readonly string[];
  out: (args: { line: string }) => void;
  precondition?: ClosePrecondition;
}): Promise<number> {
  // The deepest shell, so every caller importing this rather than `runHandoverClose` crosses the gate too.
  const gated = refuseRunnerOnStandingRuling({ noun: "handover", rest: argv.slice(VERB_ARG_OFFSET), verb: "close" });
  if (gated !== undefined) {
    return gated;
  }
  return closeRow({ argv, out, precondition });
}

/** One close, past the ruling gate {@link closeRowInProcess} asks first; its parameters are that function's. */
function closeRow({
  argv,
  out,
  precondition,
}: {
  argv: readonly string[];
  out: (args: { line: string }) => void;
  precondition: ClosePrecondition | undefined;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    out({ line: CLOSE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverCloseArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CLOSE_USAGE });
    return EXIT_USAGE;
  }
  const slug = parsed.value.positionals[0];
  const summary = parsed.value.values["summary"];
  if (slug === undefined || typeof summary !== "string" || summary.trim().length === 0) {
    logger.error({ msg: "handover close: a slug and --summary are both required" });
    logger.error({ msg: CLOSE_USAGE });
    return EXIT_USAGE;
  }
  const target = resolveRow({ slug, values: parsed.value.values, verb: "close" });
  if (typeof target === "number") {
    return target;
  }
  const url = parsed.value.values["artifact"];
  const artifact = typeof url === "string" && url.trim().length > 0 ? url.trim() : undefined;
  const written = closeUnderClosingLock({
    artifact,
    doc: target.doc,
    home: target.home,
    nowIso: nowIso(),
    precondition,
    runsDir: target.runsDir,
    summary: summary.trim(),
  });
  if (typeof written === "number") {
    return written;
  }
  out({ line: `handover close: ${slug} shipped — ${summary.trim()}` });
  out({ line: `  journal: ${written.path}` });
  // Named rather than assumed: the whole point of recording this is that nobody has to go and edit the file,
  // and a session that does not know that will edit it anyway.
  out({
    line: `  \`status:\` in ${target.doc.path} is NOT edited — every reader derives \`done\` from this event`,
  });
  if (artifact !== undefined) {
    reportArtifact({ out, target, url: artifact, verb: "close" });
  }
  return EXIT_OK;
}

/**
 * Record where a row's answer was published, superseding any earlier pointer.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverArtifact(argv: readonly string[]): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "handover", rest: argv.slice(VERB_ARG_OFFSET), verb: "artifact" });
  if (gated !== undefined) {
    return gated;
  }
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ARTIFACT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverArtifactArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: ARTIFACT_USAGE });
    return EXIT_USAGE;
  }
  const slug = parsed.value.positionals[0];
  const url = parsed.value.values["url"];
  if (slug === undefined || typeof url !== "string" || url.trim().length === 0) {
    logger.error({ msg: "handover artifact: a slug and --url are both required" });
    logger.error({ msg: ARTIFACT_USAGE });
    return EXIT_USAGE;
  }
  const target = resolveRow({ slug, values: parsed.value.values, verb: "artifact" });
  if (typeof target === "number") {
    return target;
  }
  const written = artifactUnderClosingLock({
    doc: target.doc,
    home: target.home,
    nowIso: nowIso(),
    runsDir: target.runsDir,
    url: url.trim(),
  });
  if (typeof written === "number") {
    return written;
  }
  reportArtifact({ out: logger.out, target, url: url.trim(), verb: "artifact" });
  return EXIT_OK;
}

/**
 * Say which artifact a row now points at, and what it superseded.
 *
 * @param target the resolved row
 * @param url the pointer recorded
 * @param verb the calling verb's name, so the receipt names the command that was actually run
 * @param out where the receipt goes
 */
function reportArtifact({
  out,
  target,
  url,
  verb,
}: {
  out: (args: { line: string }) => void;
  target: RowTarget;
  url: string;
  verb: string;
}): void {
  const superseded = target.doc.artifact;
  out({ line: `handover ${verb}: ${target.doc.slug}'s artifact is ${url}` });
  if (superseded !== undefined && superseded !== "null" && superseded !== url) {
    out({ line: `  supersedes ${superseded}, which stays on the journal` });
  }
}

export const handoverCloseCommand = defineCommand({ run: runHandoverClose });
export const handoverArtifactCommand = defineCommand({ run: runHandoverArtifact });
