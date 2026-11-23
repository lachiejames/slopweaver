/**
 * The owner's words, taken off the reconciliation the sweep already runs and put into the tick row VERBATIM.
 *
 * ## The measurement this module exists for
 *
 * MEASURED on a live briefing form against that same tick's `handover reconcile --json`: of the **19 owner
 * turns** the reconciliation read in its 24-hour window,
 * **0 appear in the authored page** — not verbatim, and not as a 25-character fragment. Reproduce it with
 * the two files and a normalised substring test; the matcher's own witness is a probe taken out of the form,
 * which matches, and a control string, which does not.
 *
 * What the authored narrative carries instead is a REFERENCE: a ruling named by its turn number, or a path to
 * a file holding the turn verbatim. A turn number is not the owner's words, and a path into a per-handoff
 * scratch directory is a pointer to a file that is not durable.
 *
 * So the owner's condition on deriving these sections — that they must not lose the critical information in
 * what the owner has said, and must re-derive the critical context without it being re-explained — is not a
 * risk this work introduces. It is a defect this work CLOSES: the derived row
 * stores {@link SupervisorOwnerTurn.text}, which is `../transcripts/extract.ts`'s stripped turn, and the
 * projection renders it through the quoted lane so nothing rewrites it.
 *
 * ## Two gaps this module states rather than hides
 *
 * **The window is a TIME window.** `handover reconcile` reads a trailing 24 hours rather than resuming from
 * a per-session line cursor, so a transcript line written late but carrying an older instant can fall behind
 * a floor and be read by neither tick. Every turn here carries its `transcriptLineNumber` precisely so the
 * cursor can be computed when it lands, and {@link TickChainCoverage} states what the walk could not reach.
 *
 * **A ruling is not JOINED to a turn.** `../sessionStart/lockIn.ts`'s `LockInRow` carries no owner-turn
 * pointer; a ruling's provenance lives in its free-text `note`. Prose is not a join key, so this module never
 * guesses one — every turn reads `none` for now, and the field is `recorded-before-pointer` the moment a structured
 * pointer exists and a row predates it. A wrong ruling attached to the wrong turn would be worse than the
 * gap, and the gap is on the page.
 *
 * Pure — it takes the reconciliation document already parsed, and reads a SLICE of it, exactly as
 * `../briefing/yourList.ts` reads a slice of the session-start run.
 */
import { z } from "zod";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import type { OwnerTurnSnapshot, SupervisorOwnerTurn, TickChainCoverage } from "./tickTypes.js";

/**
 * A number a turn CARRIES, which is any JavaScript number at all — including the ones JSON cannot hold.
 *
 * `z.number()` is not that: it refuses `Infinity` and `NaN`, and `JSON.parse` produces `Infinity` for the
 * perfectly valid numeric token `1e400`. One such `lineNumber` dropped both
 * its turns and the whole tick, which is why the parse accepts it. {@link finiteOrNull}
 * is the other half: accepting it and then writing it is not enough, because `JSON.stringify` turns a
 * non-finite number into `null` and the row stops reading back.
 */
const carriedNumber = z.custom<number>((value) => typeof value === "number", { message: "expected a number" });

/**
 * A carried number as the ledger can hold it: finite through unchanged, non-finite as `null`.
 *
 * The SECOND normalisation this projection performs, and the second one that is stated rather than silent.
 * It is the same trade {@link instantOf} makes: `Infinity` is not representable in JSON, so a row carrying
 * one serialises to `null` and then fails its own read — which loses every turn in that tick rather than
 * one field of one turn. A line number that is not a position carries no position, so `null` is what it
 * actually means, and unlike the value it replaces it survives the round trip.
 *
 * **One residual it does not close, stated rather than left to be found.** JSON has no negative zero, so a
 * `lineNumber` of `-0` reaches the ledger as `0`. That is true; it is also a property of the serialisation
 * rather than of this code, it applies to a line
 * POSITION rather than to anything the owner said, and `-0` and `0` name the same position. Closing it would mean
 * encoding numbers as strings throughout, which costs every reader of this ledger to preserve a distinction
 * nothing reads.
 *
 * It is applied to EVERY carried number, not only the line number: the coverage count travels the same
 * path and the same `1e400` sinks the tick through it.
 *
 * @param value the number the reconciliation carried
 * @returns the number, or `null` when JSON could not hold it
 */
function finiteOrNull({ value }: { value: number }): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * The slice of `slopweaver handover reconcile --json` this projection reads.
 *
 * Deliberately a slice: that document also carries the whole board, the ranking and the alignment sentences,
 * and a schema demanding all of them would refuse a document a later version widened. What IS demanded is
 * every field a turn needs to be quotable and checkable.
 */
const reconcileIntakeDocument = z.object({
  intake: z.discriminatedUnion("kind", [
    z.object({
      finding: z.object({
        coverage: z.object({
          earliestIso: z.string().optional(),
          linksKnown: carriedNumber,
          reachesSince: z.boolean(),
          unreadable: z.array(z.object({ claudeSessionId: z.string(), why: z.string() })),
          walked: z.array(z.string()),
        }),
        sinceIso: z.string().optional(),
        turns: z.array(
          z.object({
            inGrace: z.boolean(),
            // Every field a TURN carries is permissive, for the reason `./tickSchema.ts`'s own
            // `ownerTurnSchema` gives: a turn is decoded off a transcript this code did not write, and
            // `./chairTranscript.ts` deliberately retains one whose instant will not parse. Refusing a field
            // here would drop the owner's words rather than catch a defect.
            turn: z.object({
              lineNumber: carriedNumber,
              pointer: z.string(),
              sessionId: z.string(),
              source: z.string(),
              text: z.string(),
              timestamp: z.string(),
              turnUuid: z.string(),
            }),
            witness: z.object({ kind: z.string(), witness: z.string() }).optional(),
          }),
        ),
      }),
      kind: z.literal("read"),
    }),
    z.object({ kind: z.literal("unavailable"), why: z.string() }),
  ]),
});

/**
 * The one normalisation this projection performs, and the proof that it loses nothing.
 *
 * `../transcripts/record.ts`'s `TranscriptRecord.timestamp` is _"the record's ISO timestamp, or `\"\"` when
 * the line carried none"_, so the empty string is a SENTINEL for absent rather than a value. A tick row says
 * absent as `null`, because a ledger read months later should not have to know which sentinel this decoder
 * happened to use — and `../supervisor/chairTranscript.ts` deliberately retains a turn whose instant would not
 * read, so the state is reachable rather than theoretical.
 *
 * The mapping is therefore total and information-preserving over exactly two states: `""` ⟺ `null`, every
 * other string through unchanged. Read against a property that says an instant is carried unchanged, it
 * is not unchanged on the letter, so it is
 * a named, tested normalisation here rather than a line nobody had thought about.
 * `src/__tests__/unit/supervisor/tickOwnerWords.test.ts` pins both directions.
 *
 * @param timestamp the reconciliation's own timestamp field
 * @returns the instant, or `null` when the transcript line carried none
 */
function instantOf({ timestamp }: { timestamp: string }): string | null {
  return timestamp === "" ? null : timestamp;
}

/**
 * Project the reconciliation's intake half into a tick row's owner-turn snapshot.
 *
 * Every turn is copied, `text` byte for byte. Nothing here shortens, re-spaces, de-duplicates or drops a
 * turn — a turn that said nothing is recorded as a turn that said nothing, because the alternative is a
 * projection deciding which of the owner's words mattered. The single exception is {@link instantOf}, which maps
 * one absent-instant sentinel onto another and is lossless in both directions.
 *
 * @param document the parsed `slopweaver handover reconcile --json` output
 * @returns the snapshot, or one line per reason the document could not be read as a reconciliation
 */
export function ownerTurnSnapshotOf({
  document,
}: {
  document: unknown;
}): Result<OwnerTurnSnapshot, SupervisorCoreError> {
  const parsed = reconcileIntakeDocument.safeParse(document);
  if (!parsed.success) {
    return err(SupervisorCoreErrors.notAReconciliation({ issues: parsed.error.issues }));
  }
  const intake = parsed.data.intake;
  if (intake.kind === "unavailable") {
    return ok({
      diagnostic: unavailableReason({ why: intake.why }),
      sinceIso: null,
      status: "unavailable",
      turns: [],
    });
  }
  const finding = intake.finding;
  const turns: readonly SupervisorOwnerTurn[] = finding.turns.map((witnessed): SupervisorOwnerTurn => {
    return {
      inGrace: witnessed.inGrace,
      instantIso: instantOf({ timestamp: witnessed.turn.timestamp }),
      lockIn: null,
      lockInLink: "none",
      pointer: witnessed.turn.pointer,
      sessionId: witnessed.turn.sessionId,
      source: witnessed.turn.source,
      text: witnessed.turn.text,
      transcriptLineNumber: finiteOrNull({ value: witnessed.turn.lineNumber }),
      turnUuid: witnessed.turn.turnUuid,
      // `./intake.ts` omits `witness` when nothing on the board or ledger points at the turn. The ledger says
      // that as `null`: `JSON.stringify` drops an undefined property, and the row's own reader would refuse it.
      witness: unsetFieldAsNull({ record: witnessed, key: "witness" }),
    };
  });
  const unreadable = finding.coverage.unreadable;
  const coverage: TickChainCoverage = {
    linksKnown: finiteOrNull({ value: finding.coverage.linksKnown }),
    reachesSince: finding.coverage.reachesSince,
    unreadable,
    walked: finding.coverage.walked,
    ...(finding.coverage.earliestIso === undefined ? {} : { earliestIso: finding.coverage.earliestIso }),
  };
  // A reconciliation that read the whole chain had no floor, so it carries no `sinceIso`; the row says `null`.
  const sinceIso = unsetFieldAsNull({ record: finding, key: "sinceIso" });
  if (unreadable.length > 0 || !finding.coverage.reachesSince) {
    return ok({
      coverage,
      diagnostic: partialDiagnostic({ reachesSince: finding.coverage.reachesSince, unreadable }),
      sinceIso,
      status: "partial",
      turns,
    });
  }
  return ok({ coverage, sinceIso, status: "read", turns });
}

/**
 * Why the intake was unavailable, in words a reader can act on even when the reconciliation gave none.
 *
 * `./intake.ts`'s `IntakeReport` declares `why` as an unconstrained string, so an empty one is a shape the
 * type permits — and a row whose diagnostic is the empty string is refused by its own schema, which would
 * drop the whole tick to report that nothing was read. The substitute is COMPOSED here rather than carried, so it is ours to make non-empty,
 * and it loses nothing: there was no reason to lose.
 *
 * @param why the reason the reconciliation gave, possibly empty
 * @returns the reason, or a stated stand-in
 */
function unavailableReason({ why }: { why: string }): string {
  if (why !== "") {
    return why;
  }
  return "the reconciliation reported the owner-turn intake unavailable and gave no reason";
}

/**
 * The one-line reason an owner-turn read is `partial` rather than `read`.
 *
 * Both halves are stated, because they are different gaps: a link whose transcript would not walk is turns
 * this tick could not see at all, while a chain that does not reach the floor is turns BEFORE the window
 * that were never read. A page saying only "partial" would leave a reader unable to tell which.
 *
 * It COUNTS the unreadable links and points at `coverage.unreadable` rather than quoting each reason, and
 * that is a size decision rather than a style one. The reasons are already retained in the coverage, so
 * repeating them here doubles whatever they weigh — MEASURED: a single 53 MiB reason took the row past `safeJsonStringify`'s 100 MiB ceiling and the append refused,
 * dropping that tick's owner turn to restate something the row already held.
 *
 * @param reachesSince whether the chain walk reached the floor it was asked for
 * @param unreadable every link whose transcript would not walk, with its reason
 * @returns the diagnostic
 */
function partialDiagnostic({
  reachesSince,
  unreadable,
}: {
  reachesSince: boolean;
  unreadable: readonly { readonly claudeSessionId: string; readonly why: string }[];
}): string {
  const parts: string[] = [];
  if (unreadable.length > 0) {
    parts.push(
      `${String(unreadable.length)} supervisor transcript(s) would not walk — each one's own reason is in ` +
        "this row's `ownerTurns.coverage.unreadable`",
    );
  }
  if (!reachesSince) {
    parts.push("the chain does not reach the floor asked for, so turns before it were never read");
  }
  return parts.join(" — ");
}
