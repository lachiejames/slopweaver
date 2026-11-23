/**
 * `slopweaver handover set-priority` — state the band a board row ranks in, or write every row's default down.
 *
 * ## The gap this closes
 *
 * Every Queue card and every board row carries at least a status and a priority, the way a Linear issue does, and
 * where the board lacks one it is backfilled. Status is derived on every row; `priority:` is not. MEASURED: 1587 of
 * 4544 rows declared none —
 * `slopweaver handover list --json --all | jq '[.rows[] | select(.priority == null)] | length'`. And nothing wrote
 * one: `reconcile` tells a reader to "set `priority:` on the ones that matter" and names this verb to do it.
 *
 * ## Two writes, and why the backfill is marked
 *
 * - `<slug>... --priority p0|p1|p2|p3 --because <why>` is a JUDGEMENT: it may replace a stated band, writes the
 *   reason beside it as `priorityBecause:`, and drops a `priorityFrom:` marker — somebody chose this one.
 * - `--backfill` writes each row that declares nothing its KIND's default (`DEFAULT_PRIORITY`) with
 *   `priorityFrom: default`. The band is the one the row already ranked in, so no ranking moves; the marker is
 *   what keeps it honest. `../../../handover/rank.ts` counts any declared priority as GROOMED, and the
 *   supervisor's idle-capacity gate owes a seat to every groomed ready doc, so an unmarked backfill would have
 *   claimed a judgement for every row at once. **Dry by default**: it prints the census, `--apply` writes.
 *
 * A row is re-read and re-judged immediately before its write, inside the one lock every row writer takes
 * (`./boardRowLock.ts`), so an edit another verb makes to the same row at the same moment is never written over.
 */
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../../../config.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { BOARD_PRIORITIES, type BoardPriority } from "../../../handover/rowKind.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { type PriorityRequest, priorityPlan, setPriorityModeOf } from "./setPriorityPlan.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover set-priority` accepts. */
const SET_PRIORITY_FLAGS = {
  boolean: ["backfill", "apply"],
  string: ["priority", "because", "dir", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_SET_PRIORITY_FLAG_NAMES: readonly string[] = [
  ...SET_PRIORITY_FLAGS.string,
  ...SET_PRIORITY_FLAGS.boolean,
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover set-priority`'s own flags — exported for the help-truth ratchet. Positionals are the slugs.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverSetPriorityArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SET_PRIORITY_FLAGS });
}

export const SET_PRIORITY_USAGE =
  "usage: slopweaver handover set-priority <slug> [<slug> ...] --priority p0|p1|p2|p3 --because <why> " +
  "[--dir <path>] [--home <dir>]\n" +
  "       slopweaver handover set-priority --backfill [--apply] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "States the band a board row ranks in — the priority a Queue card shows beside its status.\n" +
  "\n" +
  "  --priority  p0 (most urgent) to p3\n" +
  "  --because   why, in one line — written beside it as priorityBecause:, so the row carries its reason\n" +
  "  --backfill  every row declaring no priority: gets its kind's default (ask p1, doc p2), marked\n" +
  "              priorityFrom: default so it ranks exactly as before and claims no judgement\n" +
  "  --apply     with --backfill, write; without it the backfill only prints what it would write\n" +
  "\n" +
  "A judgement, so a named row may be moved off a stated band. Restating a chosen band writes nothing; restating a default makes it a choice.\n" +
  "\n" +
  'example: slopweaver handover set-priority iso-gap-register --priority p0 --because "the audit gate is Friday"';

/** What writing one row did: changed it, found it already so, or refused. */
export type PriorityWrite =
  | { readonly kind: "written"; readonly from: BoardPriority | undefined; readonly priority: BoardPriority }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly problems: readonly string[] };

/**
 * Re-read one row, judge it NOW, and write the edit it needs. Another writer may have replaced the file since the
 * board scan, so the scan's copy only names the path. A write reads, judges and replaces the row inside its one lock
 * (`./boardRowLock.ts`), so a steer or pause landing at the same moment is kept rather than written over; a dry run
 * takes no lock, since it writes nothing.
 *
 * @param doc the row as the board scan read it
 * @param request a chosen band, or the backfill
 * @param apply false to judge without writing, which reports the edit as `written`
 * @param rowLock how a write waits on the row's lock when another writer holds it
 * @returns what happened to the row
 */
export function writePriority({
  doc,
  request,
  apply,
  rowLock,
}: {
  doc: HandoverDoc;
  request: PriorityRequest;
  apply: boolean;
  rowLock?: BoardRowLockOptions;
}): PriorityWrite {
  if (!apply) {
    return judgePriority({ apply, doc, request, target: doc.path });
  }
  const locked = withBoardRowLock({
    ...rowLock,
    path: doc.path,
    write: ({ target }) => judgePriority({ apply, doc, request, target }),
  });
  if (locked.isErr()) {
    return { kind: "refused", problems: [locked.error.message] };
  }
  return locked.value;
}

/**
 * {@link writePriority}'s read, judgement and write, run under the row's lock whenever it writes. `target` is the file
 * read and replaced — the real one the lock was taken on — and `doc.path` the row as the board named it.
 */
function judgePriority({
  doc,
  request,
  apply,
  target,
}: {
  doc: HandoverDoc;
  request: PriorityRequest;
  apply: boolean;
  target: string;
}): PriorityWrite {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return { kind: "refused", problems: [`cannot read ${doc.path}: ${String(cause)}`] };
  }
  const current = parseHandoverDoc({ path: doc.path, text });
  if (current.slug !== doc.slug) {
    return {
      kind: "refused",
      problems: [`${doc.path} now holds the row "${current.slug}", not "${doc.slug}" — nothing was written`],
    };
  }
  const plan = priorityPlan({ doc: current, request });
  if (plan.kind !== "edit") {
    if (plan.kind === "refused") {
      return { kind: "refused", problems: [plan.problem] };
    }
    return plan;
  }
  const edited = editFrontMatterFields({ path: doc.path, remove: plan.edit.remove, set: plan.edit.set, text });
  if (edited.isErr()) {
    return { kind: "refused", problems: frontMatterErrorLines({ error: edited.error }) };
  }
  const readBack = parseHandoverDoc({ path: doc.path, text: edited.value });
  const markerWanted = request.kind === "backfill";
  if (readBack.priority !== plan.priority || (readBack.priorityFrom !== undefined) !== markerWanted) {
    return {
      kind: "refused",
      problems: [
        `${doc.slug}: the edited front matter did not read back as priority: ${plan.priority} — nothing written`,
      ],
    };
  }
  if (apply) {
    try {
      writeFileAtomic({ contents: edited.value, path: target });
    } catch (cause: unknown) {
      return { kind: "refused", problems: [`could not write ${doc.path}: ${String(cause)}`] };
    }
  }
  return { from: current.priority, kind: "written", priority: plan.priority };
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover set-priority: ${problem}` });
  });
  logger.error({ msg: SET_PRIORITY_USAGE });
  return EXIT_USAGE;
}

/**
 * Say why a row was not written.
 *
 * @returns always `true`: the row was not written
 */
function refused({ slug, problems }: { slug: string; problems: readonly string[] }): true {
  problems.forEach((problem) => {
    logger.error({ msg: `handover set-priority: ${slug}: ${problem}` });
  });
  return true;
}

/**
 * State one named row's band, and say what happened to it.
 *
 * @param docs every doc on the board
 * @param home the installation home the board mirror is written under
 * @returns whether the row was NOT written — a refusal, or a mirror that failed
 */
async function setOne({
  docs,
  slug,
  request,
  home,
}: {
  docs: readonly HandoverDoc[];
  slug: string;
  request: PriorityRequest & { readonly kind: "set" };
  home: string;
}): Promise<boolean> {
  const claimed = docs.filter((doc) => doc.slug === slug);
  if (claimed.length !== 1) {
    const why = claimed.length === 0 ? "no row on the board claims" : `${String(claimed.length)} rows claim`;
    return refused({ problems: [`${why} the slug "${slug}"`], slug });
  }
  const doc = claimed[0]!;
  const write = writePriority({ apply: true, doc, request });
  if (write.kind === "refused") {
    return refused({ problems: write.problems, slug });
  }
  if (write.kind === "unchanged") {
    logger.out({
      line: `handover set-priority: ${slug} already states priority: ${request.priority} — nothing written`,
    });
    return false;
  }
  const was = write.from === undefined ? "" : ` (was ${write.from})`;
  logger.out({ line: `handover set-priority: ${slug} now states priority: ${write.priority}${was}` });
  return mirrorAfterWrite({ home, path: doc.path, verb: "set-priority" });
}

/**
 * Backfill one undeclared row, mirroring it when applied.
 *
 * @param doc the row as the board scan read it
 * @param home the installation home the board mirror is written under
 * @param apply whether to write
 * @returns the band written (or that would be), `unchanged`, or `failed` once its refusal is printed
 */
async function backfillOne({
  doc,
  home,
  apply,
}: {
  doc: HandoverDoc;
  home: string;
  apply: boolean;
}): Promise<BoardPriority | "unchanged" | "failed"> {
  const write = writePriority({ apply, doc, request: { kind: "backfill" } });
  if (write.kind === "refused") {
    refused({ problems: write.problems, slug: doc.slug });
    return "failed";
  }
  if (write.kind === "unchanged") {
    return "unchanged";
  }
  if (apply && (await mirrorAfterWrite({ home, path: doc.path, verb: "set-priority" }))) {
    return "failed";
  }
  return write.priority;
}

/**
 * Print the backfill's census: how many rows got which band, how many still declare none.
 *
 * @param counts rows written (or that would be) per band
 * @param failed rows that needed a priority and were not given one
 * @param apply whether the backfill wrote
 * @returns the exit code — non-zero when any row was not given a priority
 */
function backfillCensus({
  counts,
  failed,
  apply,
}: {
  counts: ReadonlyMap<BoardPriority, number>;
  failed: number;
  apply: boolean;
}): number {
  const bands = BOARD_PRIORITIES.filter((band) => counts.has(band))
    .map((band) => `${String(counts.get(band))} at ${band}`)
    .join(", ");
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const verb = apply ? "wrote" : "would write";
  const census = bands === "" ? "" : ` — ${bands}`;
  logger.out({
    line: `handover set-priority --backfill: ${verb} the kind default to ${String(total)} row(s)${census}, marked priorityFrom: default`,
  });
  if (failed > 0) {
    logger.out({
      line: `handover set-priority --backfill: ${String(failed)} row(s) still declare no priority — see above`,
    });
  }
  if (!apply && total > 0) {
    logger.out({ line: "handover set-priority --backfill: dry run — pass --apply to write" });
  }
  return failed > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Write every undeclared row's kind default down, or say what that would write.
 *
 * @param docs every doc on the board
 * @param home the installation home the board mirror is written under
 * @param apply whether to write
 * @returns the exit code — non-zero when any row that needed a priority was not given one
 */
async function backfill({
  docs,
  home,
  apply,
}: {
  docs: readonly HandoverDoc[];
  home: string;
  apply: boolean;
}): Promise<number> {
  const counts = new Map<BoardPriority, number>();
  let failed = 0;
  for (const doc of docs.filter((each) => each.priority === undefined)) {
    const outcome = await backfillOne({ apply, doc, home });
    if (outcome === "failed") {
      failed += 1;
    } else if (outcome !== "unchanged") {
      const was = counts.get(outcome);
      counts.set(outcome, was === undefined ? 1 : was + 1);
    }
  }
  return backfillCensus({ apply, counts, failed });
}

/**
 * State the named rows' band, or backfill every undeclared row's default.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when any row was not written
 */
export async function runHandoverSetPriority(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SET_PRIORITY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverSetPriorityArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const { positionals, values } = parsed.value;
  const mode = setPriorityModeOf({ positionals, values });
  if (mode.kind === "usage") {
    return usageRefused({ problems: [mode.problem] });
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const scan = scanBoard({
    handoverDir: resolveHandoverDir({ dir: typeof values["dir"] === "string" ? values["dir"] : undefined, home }),
  });
  if (scan.isErr()) {
    logger.error({ msg: `handover set-priority: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  if (mode.kind === "backfill") {
    return backfill({ apply: mode.apply, docs: scan.value.docs, home });
  }
  let failed = false;
  for (const slug of mode.slugs) {
    failed = (await setOne({ docs: scan.value.docs, home, request: mode.request, slug })) || failed;
  }
  return failed ? EXIT_ERROR : EXIT_OK;
}

export const handoverSetPriorityCommand = defineCommand({ run: runHandoverSetPriority });
