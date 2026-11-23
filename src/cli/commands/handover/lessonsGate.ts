/**
 * The lesson question, asked at the one moment it can still be answered cheaply: as a run ends.
 *
 * The pure predicate lives in `../../../knowledge/declared.ts` and the refusal wording with it; this module is
 * the effectful shell both `handover finish` and `handover settle` call — it reads the run's lessons, reads
 * the journal, and writes the `lessons` event when the answer is an explicit nothing.
 *
 * ## The register is the memories table, so a settle now needs the store
 *
 * `knowledge record` writes the `memories` table, and this gate reads it.
 * The consequence is fleet-wide and is stated rather than discovered — every `handover settle` and
 * `handover finish` on a STARTED run needs the store reachable (`docs/store/overview-and-local-stack.md`, `skills/knowledge/SKILL.md`).
 * An unreachable store REFUSES here, loudly, carrying the database's own reason: the register being
 * unreadable must never be indistinguishable from an unanswered question, or an outage silently satisfies a
 * gate whose entire job is to refuse silence. That property is unchanged from the file era — only what is
 * unreadable moved.
 *
 * ## `--lessons none` is checked AFTER the register, and that ordering is the honesty
 *
 * The register is read first, so a run that DID record something is told so and the `none` never applies —
 * exactly as it behaved when the register was a file. When the store cannot be reached the gate cannot tell
 * those two apart, so `--lessons none` does NOT pass there: the only way through an outage is the
 * break-glass, which is loud and journals `forced: true`. A refusal whose own escape does not work is the
 * wedge `.claude/rules/error-handling.md` exists to avoid, and an unreachable store is precisely when a
 * session most needs one — but an ordinary `none` claiming a run learned nothing, written while nothing
 * could check it, is the silent pass the brief rules out.
 *
 * ## When the gate does NOT fire, and why that is not a hole
 *
 * Only a run that was actually STARTED is asked. A journal with no `started` event in it belongs to a row
 * that was settled as bookkeeping — filed against a doc somebody else will execute, or declined — and no
 * investigation happened inside it that could have learned anything. Asking there would produce exactly the
 * filler the ruling's `--lessons none` escape exists to avoid, and every honest answer would be the same one.
 *
 * ## A dry run journals NOTHING
 *
 * `handover finish --dry-run` runs every check here and writes no event, because a dry run's contract is that
 * the journal is byte-identical afterwards — `unit/handover/lifecycle.test.ts` asserts exactly that, and it
 * caught this gate writing a `lessons` event on a preview. The refusal path is UNCHANGED by `--dry-run`: a
 * dry run that has not answered still refuses, because previewing a success that would not happen is worse
 * than the write it avoids.
 *
 * The gate also does not fire on `handover abandon`. An abandoned run is the case where a session gave up,
 * and the reason it gave up is already recorded on the `abandoned` event; forcing a second declaration at
 * that moment adds a refusal to the one path whose whole purpose is to let a stuck session stop cleanly.
 * That is a judgement rather than something the ruling settles, and it is stated here rather than left to be
 * discovered.
 */
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import {
  ALLOW_NO_LESSONS,
  LESSONS_NONE,
  lessonsDeclaration,
  lessonsRefusalLines,
} from "../../../knowledge/declared.js";
import { type KnowledgeError, KnowledgeErrors } from "../../../knowledge/errors.js";
import { readLessonRows } from "../../../knowledge/memoryStore.js";
import type { LessonRow } from "../../../knowledge/types.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { connectStore } from "../../../store/client.js";

/**
 * How the gate reads what a run recorded.
 *
 * A seam rather than a direct call, so a unit test can exercise every branch of this module without a
 * database — `.claude/rules/testing.md` bans the mock that would otherwise be needed, and a plain function
 * passed in is not one. The default is {@link storeLessons}, which is what every real caller gets.
 */
export type LessonsReader = ({
  slug,
  home,
  catchUp,
}: {
  slug: string;
  home: string;
  /** Whether the store door may catch a behind database up; `false` under a dry run, which changes nothing. */
  catchUp: boolean;
}) => Promise<Result<readonly LessonRow[], KnowledgeError>>;

/**
 * Read this run's lessons from the memories table, opening and closing one connection.
 *
 * @internal — the gate's own default reader. Exported only so the type above has a named default a reader
 * can follow; nothing outside this module calls it.
 *
 * Narrowed to the run at the database rather than read whole and filtered here: the gate asks only about
 * itself, and the register is the whole installation's.
 *
 * @param slug the doc's slug, which is the row's `run`
 * @param home the state home the store selection is remembered under
 * @returns this run's lesson rows, or the typed database failure
 */
export const storeLessons: LessonsReader = async ({ slug, home, catchUp }) => {
  const opened = await connectStore({ catchUp, home });
  if (opened.isErr()) {
    // Mapped into this domain's own union at the boundary rather than forwarded, so every caller of the seam
    // handles one error type — `.claude/rules/error-handling.md`. The store's own refusal text, which names
    // the database and how to select one, is carried through as the cause and reaches the printed message.
    return err(KnowledgeErrors.databaseFailed({ cause: opened.error.message, doing: "reach the memories table" }));
  }
  const client = opened.value;
  try {
    return await readLessonRows({ client, run: slug });
  } finally {
    await client.close();
  }
};

/**
 * Ask the lesson question, and say whether the calling verb must refuse — {@link lessonsGateVerdict} journalling
 * every answer, a forced one included, at once. Every field is that function's, documented there.
 *
 * @returns true when the caller must stop and print nothing further
 */
export async function lessonsGateRefuses(
  args: Omit<Parameters<typeof lessonsGateVerdict>[0], "deferForced">,
): Promise<boolean> {
  return (await lessonsGateVerdict({ ...args, deferForced: false })) === "refused";
}

/**
 * How the lesson question came out: `refused`, `passed` (answered, or the run never started), or `forced` — the
 * break-glass let it through and, because the caller deferred it, nothing was journalled yet.
 */
export type LessonsGateVerdict = "refused" | "passed" | "forced";

/**
 * Ask the lesson question, and say how it came out — {@link lessonsGateRefuses} with the forced write optionally
 * left to the caller.
 *
 * `handover finish` defers it, because the forced `lessons` line counts as an answer
 * (`../../../knowledge/declared.ts`), and finish's page and probe gates run AFTER this one, so a forced line
 * journalled here on a run those gates then refuse spends the question on a run still owing work. Deferred, finish
 * writes it with {@link recordForcedLessons} under the closing lock, once its own `finished` append succeeded.
 *
 * @param slug the doc's slug — matched against each row's `run`
 * @param verb the verb being gated, interpolated into every line so the message names what was typed
 * @param runsDir where the journal lives
 * @param home the state home the store selection is remembered under
 * @param nowIso the instant to stamp a recorded `none` with
 * @param lessons the `--lessons` flag's value, when one was passed
 * @param dryRun when true, every check runs and NOTHING is journalled
 * @param deferForced when true, a forced pass is reported as `forced` and NOT journalled; an explicit `none` is
 *   still journalled at once, since it is an answer whatever the later gates say
 * @param readLessons how to read this run's rows; defaults to the memories table
 * @param out where the gate's report lines go — stdout by default; an in-process settle passes its caller's channel
 * @returns the verdict; `refused` means the caller must stop and print nothing further
 */
export async function lessonsGateVerdict({
  slug,
  verb,
  runsDir,
  home,
  nowIso,
  lessons,
  deferForced,
  dryRun = false,
  readLessons = storeLessons,
  out = logger.out,
}: {
  slug: string;
  verb: string;
  runsDir: string;
  home: string;
  nowIso: string;
  lessons: string | undefined;
  deferForced: boolean;
  dryRun?: boolean;
  readLessons?: LessonsReader | undefined;
  out?: (args: { line: string }) => void;
}): Promise<LessonsGateVerdict> {
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    logger.error({ msg: `handover ${verb}: ${journal.error.message}` });
    return "refused";
  }
  const events = journal.value.events;
  const started = events.findLast((event) => event.kind === "started");
  if (started === undefined) {
    return "passed";
  }
  const rows = await readLessons({ catchUp: !dryRun, home, slug });
  if (rows.isErr()) {
    // Deliberately a refusal rather than "no rows": an unreadable register must never be indistinguishable
    // from an unanswered question, or an outage silently satisfies the gate. The break-glass still works
    // here, loudly and on the journal — a refusal whose own escape does not work is the wedge
    // `.claude/rules/error-handling.md` exists to avoid, and an unreachable store is precisely when a
    // session most needs one.
    logger.error({ msg: `handover ${verb}: ${rows.error.message}` });
    return nothingLearnedAccepted({ deferForced, dryRun, lessons: undefined, nowIso, out, runsDir, slug, verb });
  }
  const declaration = lessonsDeclaration({ events, rows: rows.value, slug, startedAtIso: started.atIso });
  if (declaration.declared) {
    reportDeclared({ declaration, out, verb });
    return "passed";
  }
  const accepted = nothingLearnedAccepted({ deferForced, dryRun, lessons, nowIso, out, runsDir, slug, verb });
  if (accepted !== "refused") {
    return accepted;
  }
  lessonsRefusalLines({ slug, verb }).forEach((line) => {
    logger.error({ msg: line });
  });
  return "refused";
}

/**
 * Journal a forced pass a caller deferred with {@link lessonsGateVerdict}, once the verb it forced is past its
 * last gate.
 *
 * @param nowIso the instant to stamp
 * @param runsDir where the journal is written
 * @param slug the doc's slug
 */
export function recordForcedLessons({
  nowIso,
  runsDir,
  slug,
}: {
  nowIso: string;
  runsDir: string;
  slug: string;
}): void {
  recordAnswer({ forced: true, nowIso, runsDir, slug });
}

/**
 * The two ways a run with no recorded lesson may still pass: an explicit `none`, and the break-glass.
 *
 * Both journal a `lessons` event on a real run so the answer — honest or forced — is on the record, and
 * neither writes anything on a dry run.
 *
 * @param lessons the `--lessons` flag's value
 * @param dryRun whether this is a preview, in which case nothing is journalled
 * @param nowIso the instant to stamp
 * @param runsDir where the journal is written
 * @param slug the doc's slug
 * @param verb the verb being gated, named in every line
 * @param out where the recorded-answer line goes
 * @param deferForced whether a forced pass is left for the caller to journal
 * @returns `passed` for a recorded `none`, `forced` for the break-glass, `refused` when neither applied
 */
function nothingLearnedAccepted({
  deferForced,
  lessons,
  dryRun,
  nowIso,
  out,
  runsDir,
  slug,
  verb,
}: {
  deferForced: boolean;
  lessons: string | undefined;
  dryRun: boolean;
  nowIso: string;
  out: (args: { line: string }) => void;
  runsDir: string;
  slug: string;
  verb: string;
}): LessonsGateVerdict {
  const forced = lessons !== LESSONS_NONE;
  if (forced && process.env[ALLOW_NO_LESSONS] !== "1") {
    return "refused";
  }
  const journalNow = !dryRun && !(forced && deferForced);
  if (journalNow) {
    recordAnswer({ forced, nowIso, runsDir, slug });
  }
  if (forced) {
    logger.error({
      msg: `handover ${verb}: FORCED past the lesson question by ${ALLOW_NO_LESSONS}=1 — the override is on the run's journal, so say so in the PR`,
    });
    return "forced";
  }
  out({
    line: dryRun
      ? `handover ${verb}: dry run — would record that this run learned nothing worth registering`
      : `handover ${verb}: recorded that this run learned nothing worth registering`,
  });
  return "passed";
}

/** Say what was found, so a session closing a run sees the register grow rather than only the gate pass. */
function reportDeclared({
  declaration,
  out,
  verb,
}: {
  declaration: ReturnType<typeof lessonsDeclaration>;
  out: (args: { line: string }) => void;
  verb: string;
}): void {
  if (declaration.recorded > 0) {
    out({
      line: `handover ${verb}: ${String(declaration.recorded)} lesson(s) recorded on this run — \`slopweaver knowledge list --run\` to read them back`,
    });
    return;
  }
  out({ line: `handover ${verb}: this run already recorded that it learned nothing` });
}

/** Journal the answer. A `none` and a forced pass are both written, so the second is findable afterwards. */
function recordAnswer({
  forced,
  nowIso,
  runsDir,
  slug,
}: {
  forced: boolean;
  nowIso: string;
  runsDir: string;
  slug: string;
}): void {
  void applyRowEvent({
    event: { atIso: nowIso, forced, kind: "lessons", lessons: LESSONS_NONE },
    runsDir,
    slug,
  });
}
