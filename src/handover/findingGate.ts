/**
 * The team-facing gate on a FINDING row: which row a branch belongs to, and whether the owner has ruled on it.
 *
 * ## The defect, measured
 *
 * `watchpr-dies-silent-on-an-unchosen-signal` was registered by a supervisor from two
 * watcher deaths a session had observed. Nobody asked. It ranked as the owner's ask, read as the owner's ask,
 * became a pull request on a team-reviewed base under the owner's name, and the owner closed it the next night
 * with no memory of asking and no idea where it came from. The rule: a finding MAY be registered as
 * an ask — that mechanism stays — but a finding-sourced row that would produce TEAM-FACING output asks the
 * owner first. This module is the mechanical half: the doors that reach a teammate call {@link findingGateVerdict}
 * and refuse on anything but `clear`.
 *
 * ## How a branch finds its row
 *
 * Three exact matches, never a resemblance: the row's declared `branch:`, the branch its run journal
 * recorded at `handover start`, or the slug itself (the default branch name `cmux spawn` gives a run). Name
 * similarity is the fuzzy matching this repository forbids — a wrong `in-flight` guess once hid a
 * fortnight of work (`./doc.ts`'s `branch` field) — so a branch matching none of these is simply not a
 * finding's branch, and the door stays open. That is the honest failure direction: an unmatched finding
 * still shows its origin on the board and on the page, where the owner reads it.
 *
 * Pure: rows and their journal events in, a verdict out. No filesystem.
 */

import { absentAs, absentAsEmpty } from "#lib/absent.js";
import { collapseWhitespace } from "#lib/oneLineSummary.js";
import { findingRulingState } from "./askRow.js";
import { derivedRowState } from "./derivedRowState.js";
import type { HandoverDoc } from "./doc.js";
import { type RunEvent, runStateOf } from "./ledger.js";
import { type RulingEvidence, rulingAnchor } from "./ruling.js";

/**
 * What a team-facing door learns about the branch it is about to act on.
 *
 * @internal — {@link findingGateVerdict}'s own return shape; callers pass it straight to {@link findingGateLines}.
 */
export type FindingGateVerdict =
  /** No finding row claims this branch, or the one that does carries the owner's ruling — which the line names. */
  | { readonly kind: "clear"; readonly row: HandoverDoc | undefined; readonly ruling: RulingEvidence | undefined }
  /**
   * A finding row claims this branch, the owner has not ruled on it, and the door is INTERNAL — so it opens on the
   * session's own judgement and leaves an autonomy-ledger row instead of waiting for the owner.
   */
  | { readonly kind: "internal"; readonly row: HandoverDoc }
  /** A finding row claims this branch and the owner has not ruled on it. */
  | { readonly kind: "unruled"; readonly row: HandoverDoc }
  /** A finding row claims this branch and the owner settled it declined. */
  | { readonly kind: "declined"; readonly row: HandoverDoc };

/**
 * The finding row a branch belongs to, if any.
 *
 * @param docs every row on the board
 * @param journals each row's run-journal events, by slug — absent when the row has no journal at all
 * @param branch the head branch a door is about to act on
 * @returns the finding row, or `undefined` when no finding row claims the branch
 */
export function findingRowForBranch({
  docs,
  journals,
  branch,
}: {
  docs: readonly HandoverDoc[];
  journals: ReadonlyMap<string, readonly RunEvent[]>;
  branch: string;
}): HandoverDoc | undefined {
  return docs.find((doc) => {
    if (doc.origin !== "finding") {
      return false;
    }
    const recorded = runStateOf({ events: absentAsEmpty({ value: journals.get(doc.slug) }) }).branch;
    return doc.branch === branch || recorded === branch || doc.slug === branch;
  });
}

/**
 * Whether a team-facing door may act on this branch.
 *
 * The journal is passed WHOLE rather than reduced to a branch string, and that is what the ruling's
 * placement forces: the owner's ruling lives in the same journal the branch does, so a caller that reduced it to a
 * branch on the way in had already thrown away the evidence this gate exists to read.
 *
 * @param docs every row on the board
 * @param journals each row's run-journal events, by slug
 * @param branch the head branch a door is about to act on
 * @returns the verdict, carrying the row so a refusal can name it
 */
export function findingGateVerdict({
  docs,
  journals,
  branch,
  internal = false,
}: {
  docs: readonly HandoverDoc[];
  journals: ReadonlyMap<string, readonly RunEvent[]>;
  branch: string;
  /**
   * Whether the door this verdict is for reaches NOBODY but the owner — a pull request on this install's own
   * repository. Defaults false, so a caller that has not thought about it gets the team-facing answer.
   */
  internal?: boolean;
}): FindingGateVerdict {
  const row = findingRowForBranch({ branch, docs, journals });
  if (row === undefined) {
    return { kind: "clear", row: undefined, ruling: undefined };
  }
  const derived = derivedRowState({ doc: row, events: absentAsEmpty({ value: journals.get(row.slug) }) });
  const state = findingRulingState({ derived, doc: row });
  if (state === "declined") {
    // DECLINED refuses on an internal door too, and that is the one asymmetry here. The owner said
    // no to this specific work; "no" and "never spoke about it" are different facts, and only the second is
    // handed to the session's judgement.
    return { kind: "declined", row };
  }
  if (state === "unruled") {
    return internal ? { kind: "internal", row } : { kind: "unruled", row };
  }
  return { kind: "clear", row, ruling: derived.findingRuling };
}

/** The anchor a cleared ruling names, or the honest absence — a `clear` with no finding row has neither. */
function anchorOf({ ruling }: { ruling: RulingEvidence | undefined }): string {
  return ruling === undefined ? "no anchor recorded" : rulingAnchor({ evidence: ruling });
}

/**
 * What the finding gate IS, in one sentence, printed above every refusal it makes.
 *
 * A card asking the owner to rule on this gate has to say what the gate is first. A refusal naming a
 * mechanism nobody has defined is a refusal the reader cannot act on, whether that reader is the owner or a
 * session.
 *
 * @internal — this module's own refusal text; no caller outside it names the constant.
 */
export const WHAT_THE_FINDING_GATE_IS =
  "the finding gate is the rule that a row a SESSION registered from what it observed, rather than " +
  "something the owner asked for, does not reach a teammate until the owner has seen it";

/**
 * The lines a door prints for a verdict — a refusal that names the row, its origin and the one verb that
 * clears it, or a single line saying the branch is a ruled finding, or nothing at all for a branch no
 * finding claims.
 *
 * @param verdict what {@link findingGateVerdict} decided
 * @param action what the door was about to do, in the door's own words (`open a pull request on staging`)
 * @returns the lines to print, and whether the door must refuse
 */
export function findingGateLines({ verdict, action }: { verdict: FindingGateVerdict; action: string }): {
  readonly lines: readonly string[];
  readonly refused: boolean;
} {
  if (verdict.kind === "clear") {
    if (verdict.row === undefined) {
      return { lines: [], refused: false };
    }
    return {
      lines: [
        `finding gate: ${verdict.row.slug} carries the owner's ruling (${anchorOf({ ruling: verdict.ruling })}) — proceeding`,
      ],
      refused: false,
    };
  }
  const row = verdict.row;
  // Decoded scalars may carry a line break (`./flatScalarCodec.ts`); this is one printed line, so it is collapsed.
  const evidence = collapseWhitespace({ text: row.evidence.join(", ") });
  const observedBy = collapseWhitespace({
    text: absentAs({ value: row.observedBy, whenAbsent: "an unrecorded session" }),
  });
  const origin =
    `${row.slug} is a fleet finding, not something the owner asked for — observed by ` +
    `${observedBy} from ${evidence === "" ? "unrecorded evidence" : evidence}`;
  if (verdict.kind === "internal") {
    return {
      lines: [
        `finding gate: ${row.slug} is an unruled fleet finding, and this door reaches nobody but the owner —`,
        "  proceeding on this session's judgement under rule 10, recorded in the autonomy ledger",
        `  ${origin}`,
      ],
      refused: false,
    };
  }
  if (verdict.kind === "declined") {
    return {
      lines: [
        `refused: finding-declined: cannot ${action} for ${row.slug}`,
        `  ${WHAT_THE_FINDING_GATE_IS}`,
        `  ${origin}`,
        `  the owner settled it declined: ${absentAs({ value: row.settlementReason, whenAbsent: "no reason recorded" })} (${absentAs({ value: row.settlementWitness, whenAbsent: "no witness" })})`,
      ],
      refused: true,
    };
  }
  return {
    lines: [
      `refused: finding-unruled: cannot ${action} for ${row.slug} until the owner has ruled on it`,
      `  ${WHAT_THE_FINDING_GATE_IS}`,
      `  ${origin}`,
      "  a teammate must not receive work the owner has not seen — present the finding to the owner, then record their word:",
      `  slopweaver handover rule ${row.slug} --anchor <where the owner said it> --words "<the owner's words>"`,
      `  or, if the owner says no: slopweaver handover settle ${row.slug} --as declined --witness <anchor> --reason "<the owner's words>"`,
    ],
    refused: true,
  };
}
