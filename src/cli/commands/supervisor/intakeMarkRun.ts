/**
 * `slopweaver supervisor intake-mark` — the write edge of the intake check.
 *
 * It records the other ways a turn is acted on — it became a page card, it answered something, or it asked for
 * nothing — in the ledger `supervisor intake` (`./intakeRun.ts`) reads. It decides nothing about the turn; it refuses
 * a `transcript:` pointer naming no record intake reads a mark on (`markTargetRefusal`, which carries one chair's
 * measurement, `../../../supervisor/intakeMarkTarget.ts`), and a free-text witness spread across too many of the owner's turns, judged by
 * `../../../supervisor/intakeWitness.ts`, which carries the 183-turn measurement. An `answered` turn whose witness
 * routes it to a board row is carried onto that row as one more of the owner's steers before it is marked, or refused naming
 * the command that would carry it (`../../../supervisor/intakeRoute.ts`, the 20-stretch measurement).
 */
import { join } from "node:path";

import { ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import { rowBySlug } from "../../../handover/rowBySlug.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { readMarkableRecords } from "../../../supervisor/chairTranscript.js";
import {
  buildIntakeMark,
  INTAKE_MARK_KINDS,
  type IntakeMark,
  type IntakeMarkKind,
} from "../../../supervisor/intake.js";
import { markTargetRefusal } from "../../../supervisor/intakeMarkTarget.js";
import { carryCommand, routedRows } from "../../../supervisor/intakeRoute.js";
import {
  appendIntakeMark,
  type BoardSlugLookup,
  boardSlugLookup,
  readIntakeMarks,
} from "../../../supervisor/intakeStore.js";
import { type SlugLookup, witnessReuse } from "../../../supervisor/intakeWitness.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";
import { parseTurnPointer } from "../../../transcripts/pointer.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { readWordsAtAnchor } from "../handover/quoteSteerRow.js";
import { relateOneSteer } from "../handover/quoteSteerRun.js";
import { settleRelayAtAct } from "../handover/relaySettleAtAct.js";
import { instantProblem, refuse } from "./intakeFlags.js";
import { MARK_USAGE } from "./intakeUsage.js";

/** `intake-mark`'s flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const INTAKE_MARK_FLAG_SPEC = {
  boolean: [],
  value: ["turn", "as", "witness", "now", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** What `supervisor intake-mark` resolves to. */
export interface IntakeMarkOptions {
  readonly turn: string;
  readonly as: IntakeMarkKind;
  readonly witness: string;
  readonly nowIso: string | undefined;
  readonly home: string | undefined;
}

/**
 * Parse `intake-mark`'s flag tail. No I/O — a `transcript:` pointer is checked against its transcript by the caller.
 *
 * @param rest the flag tail, after the noun/verb tokens
 * @returns the options, or every rejection
 */
export function parseIntakeMarkOptions({ rest }: { rest: readonly string[] }): Result<IntakeMarkOptions> {
  const parsed = parseFlagTail({ rest, spec: INTAKE_MARK_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const turn = values["turn"];
  if (turn === undefined) {
    problems.push("--turn is required — a transcript:<sid>#<uuid>, talk:<id> or talk-call:<call>#<segment> pointer");
  }
  const as = INTAKE_MARK_KINDS.find((kind) => kind === values["as"]);
  if (as === undefined) {
    problems.push(`--as is required and must be one of ${INTAKE_MARK_KINDS.join("|")}`);
  }
  const witness = values["witness"];
  if (witness === undefined || witness.trim().length === 0) {
    problems.push(
      "--witness is required — the card's question, where the answer went, or why the turn asked for nothing",
    );
  }
  const nowProblem = instantProblem({ name: "now", value: values["now"] });
  if (nowProblem !== undefined) {
    problems.push(nowProblem);
  }
  if (problems.length > 0 || turn === undefined || as === undefined || witness === undefined) {
    return err(problems);
  }
  return ok({ as, home: values["home"], nowIso: values["now"], turn, witness });
}

/** How many of the turns already carrying a refused witness the refusal names. */
const REUSE_POINTERS_SHOWN = 3;

/**
 * Whether `intake-mark` must refuse this mark because its free-text witness already marks too many other turns,
 * printing the registered refusal when it does. An unreadable ledger refuses too: "could not count" must never
 * read as "under the limit".
 */
function witnessReuseRefused({ home, mark, slugs }: { home: string; mark: IntakeMark; slugs: SlugLookup }): boolean {
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    logger.error({ msg: `supervisor intake-mark: ${marks.error.message}` });
    return true;
  }
  const reuse = witnessReuse({
    marks: marks.value,
    pointer: mark.pointer,
    slugs,
    witness: mark.witness,
  });
  if (reuse === undefined || process.env["SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE"] === "1") {
    return false;
  }
  const shown = reuse.otherPointers.slice(0, REUSE_POINTERS_SHOWN).join(", ");
  const more = reuse.otherPointers.length > REUSE_POINTERS_SHOWN ? ", …" : "";
  const detail = `${JSON.stringify(reuse.witness)} already marks ${String(reuse.otherPointers.length)} other turn(s): ${shown}${more}`;
  logger.error({ msg: hatchRefusal({ detail, hatch: hatchFor({ id: "intake-witness-reuse" }) }) });
  return true;
}

/**
 * Carry an `answered` turn onto every board row its witness routes it to (`../../../supervisor/intakeRoute.ts`
 * carries the 20-stretch measurement), as one more steer of the owner's on each — or refuse, naming the command that would.
 * Any other kind carries nothing: a `card` witness is the card's question, and a `no-ask` turn asked for nothing.
 *
 * @returns true when the mark may be written — nothing was routed, or every routed row now carries the turn
 */
async function carriedOntoRoutedRows({
  handoverDir,
  home,
  mark,
  slugs,
}: {
  handoverDir: string;
  home: string;
  mark: IntakeMark;
  slugs: BoardSlugLookup;
}): Promise<boolean> {
  if (mark.kind !== "answered") {
    return true;
  }
  // `slugs` is the one `boardSlugLookup` the reuse check already asked: the exact path first, then at most ONE board
  // scan for the whole mark, however many hyphenated words a prose witness carries. Exact-path routing alone misses a
  // row filed under another name that declares the slug, and marks the turn answered without it.
  const misses: string[] = [];
  const recording: SlugLookup = {
    has: (slug) => {
      const held = slugs.has(slug);
      if (!held) {
        misses.push(slug);
      }
      return held;
    },
  };
  const routed = routedRows({ slugs: recording, witness: mark.witness });
  // A miss on a board that would not list is no answer: a row filed under another name may declare that very slug,
  // and marking now would lose the owner's words. A hit needs no listing.
  const unlistable = slugs.unlistable();
  if (misses.length > 0 && unlistable.length > 0) {
    logger.error({
      msg:
        `supervisor intake-mark: could not tell whether ${JSON.stringify(mark.witness)} routes ${mark.pointer} to a ` +
        `row — the board would not list (${unlistable.join("; ")}). Nothing was marked. Make the board readable, ` +
        "then mark the turn again.",
    });
    return false;
  }
  for (const slug of routed) {
    const failed = await carryOnto({ handoverDir, home, pointer: mark.pointer, slug });
    if (failed !== undefined) {
      // The carry command is named only where it can reach a row: run verbatim, it repeats the same resolver and the
      // same pointer check, so for an ambiguous slug or a pointer to no words of the owner's it would refuse again.
      let next = `Carry them with \`${carryCommand({ home, pointer: mark.pointer, slug })}\`, then mark the turn again.`;
      if (failed.remedy !== undefined) {
        next = failed.remedy;
      }
      logger.error({
        msg:
          `supervisor intake-mark: ${mark.pointer} routes to ${slug}, and its words were not carried onto that row — ` +
          `${failed.problem}. Nothing was marked. ${next}`,
      });
      return false;
    }
  }
  return true;
}

/** Why a routed row did not take the owner's words, and — when the carry command could not reach it either — what will. */
interface CarryFailure {
  readonly problem: string;
  /** Set only when `handover quote --add-steer` would refuse the same way, so naming it would be a dead end. */
  readonly remedy?: string;
}

/** One routed row: its words related as a steer, the line printed — or why they could not be. */
async function carryOnto({
  handoverDir,
  home,
  pointer,
  slug,
}: {
  handoverDir: string;
  home: string;
  pointer: string;
  slug: string;
}): Promise<CarryFailure | undefined> {
  if (ownerWordsSchemeOf({ anchor: pointer }) === undefined) {
    return {
      problem: "the pointer names none of the owner's words (talk:, call:, talk-call:, transcript:)",
      remedy: "Mark it with a pointer to one of the owner's turns, or with a witness that routes to no row.",
    };
  }
  // The resolver `handover quote --add-steer` uses, so the carry command a refusal names reaches this same row.
  const row = rowBySlug({ handoverDir, slug });
  if (row.isErr()) {
    if (row.error.code === "SLUG_DECLARED_TWICE") {
      return {
        problem: row.error.message,
        remedy: `Leave "${slug}" declared by one file only, then mark the turn again.`,
      };
    }
    return { problem: row.error.message };
  }
  // Read first, by the read the steer writer itself takes: a pointer whose words will not read (a call record not yet
  // on disk) would write only an `unread` placeholder — the owner's pointer on the row without their words.
  const words = readWordsAtAnchor({ anchor: pointer, home });
  if (words.isErr()) {
    return {
      problem: `the owner's words at ${pointer} would not read — ${words.error.message}`,
      remedy: "Mark the turn again once its words read.",
    };
  }
  let outcome: Awaited<ReturnType<typeof relateOneSteer>>;
  try {
    outcome = await relateOneSteer({ anchor: pointer, apply: true, home, path: row.value.path });
  } catch (cause: unknown) {
    // The row lock's directory can throw rather than answer a Result (an unwritable board, measured on the fixture).
    return { problem: `the write threw: ${String(cause)}` };
  }
  if (outcome.writeFailed || outcome.verdict === "defect") {
    return { problem: outcome.line };
  }
  logger.out({ line: `supervisor intake-mark: carried onto ${slug} — ${outcome.line}` });
  return undefined;
}

/**
 * Why a `transcript:` mark would witness nothing, read off its own transcript; `undefined` for a mark that lands, and
 * for a `talk:` or `talk-call:` pointer, which names no transcript record.
 */
function transcriptTargetRefusal({ pointer }: { pointer: string }): string | undefined {
  const target = parseTurnPointer({ text: pointer });
  if (target === undefined) {
    return undefined;
  }
  const records = readMarkableRecords({
    projectsDir: join(claudeHomeDir(), "projects"),
    sessionId: target.sessionId,
  });
  return markTargetRefusal({ pointer: target, records });
}

/**
 * `supervisor intake-mark` — record what a turn became.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
async function runIntakeMark(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["intake-mark"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: MARK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseIntakeMarkOptions({ rest });
  if (parsed.isErr()) {
    return refuse({ errors: parsed.error, usage: MARK_USAGE });
  }
  const options = parsed.value;
  // An empty id is written as such rather than refused: the mark is attributable, never authenticated, and a
  // mark from outside a Claude session is still a mark somebody chose to write.
  const sessionEnv = process.env[CLAUDE_CODE_SESSION_ID_ENV];
  // No `--now` means the mark is made now; the flag exists so a test can pin the instant.
  let markedAtIso = new Date().toISOString();
  if (options.nowIso !== undefined) {
    markedAtIso = options.nowIso;
  }
  const built = buildIntakeMark({
    byClaudeSessionId: sessionEnv === undefined ? "" : sessionEnv.trim(),
    kind: options.as,
    markedAtIso,
    pointer: options.turn,
    witness: options.witness,
  });
  if ("refusal" in built) {
    return refuse({ errors: [built.refusal], usage: MARK_USAGE });
  }
  const target = transcriptTargetRefusal({ pointer: built.mark.pointer });
  if (target !== undefined) {
    return refuse({ errors: [target], usage: MARK_USAGE });
  }
  const home = resolveHome({ named: options.home });
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  const slugs = boardSlugLookup({ handoverDir });
  if (witnessReuseRefused({ home, mark: built.mark, slugs })) {
    return EXIT_ERROR;
  }
  if (!(await carriedOntoRoutedRows({ handoverDir, home, mark: built.mark, slugs }))) {
    return EXIT_ERROR;
  }
  try {
    appendIntakeMark({ home, mark: built.mark });
  } catch (cause: unknown) {
    logger.error({ msg: `supervisor intake-mark: could not write the ledger: ${String(cause)}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `supervisor intake-mark: ${built.mark.pointer} is ${built.mark.kind} — ${built.mark.witness}` });
  // A mark on a voice relay is the chair's disposition of it, so the relay's own row ends with it.
  await settleRelayAtAct({ dir: undefined, home, pointer: built.mark.pointer, verb: "supervisor intake-mark" });
  return EXIT_OK;
}

export const supervisorIntakeMarkCommand = defineCommand({ run: runIntakeMark });
