/**
 * What `talk relay` prints once a turn is on the board — the `--json` document the console reads, or the lines
 * an operator reads. Split from `./relayRun.ts`, which decides what happens; this only says what did, as lines
 * the verb writes out, so the wording is tested without a process.
 */
import type { CheckInRuling } from "../../../talk/checkInRuling.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import { pictureClause } from "../../../talk/relayAskText.js";
import { reachedSupervisorChat } from "../../../talk/relayIntake.js";
import { droppedReadingWhy } from "../../../talk/relayReadSources.js";
import type { TurnRecord } from "../../../talk/relayStore.js";
import { type CandidateRulingOutcome, candidateRulingField, candidateRulingLine } from "./relayCandidateRuling.js";

/** What became of a reaction to a check-in: the cards their word now settles, or why none were recorded. */
export type RulingOutcome =
  { readonly kind: "recorded"; readonly ruling: CheckInRuling } | { readonly kind: "refused"; readonly why: string };

/**
 * The ruling as the `--json` document carries it, for the voice to say how many cards their word cleared.
 *
 * @returns the document's `ruling` field, or `null` when the relay recorded no ruling
 */
function rulingField({ ruling }: { ruling: RulingOutcome | undefined }): Readonly<Record<string, unknown>> | null {
  if (ruling === undefined) {
    return null;
  }
  if (ruling.kind === "refused") {
    return { recorded: false, why: ruling.why };
  }
  const { covers, kind, place, settled } = ruling.ruling;
  return { cleared: settled.length, covers, kind, place, recorded: true };
}

/**
 * A delivery's kind, then its refusal class when nothing was typed, then the chair's courier when the relay went
 * through it.
 *
 * @returns e.g. `failed (courier-unavailable), via the chair's courier`
 */
export function deliveryHead({ delivery }: { delivery: Delivery }): string {
  let head: string = delivery.kind;
  if (delivery.kind === "failed" || delivery.kind === "skipped") {
    head = `${head} (${delivery.refusal})`;
  }
  if (delivery.via === "courier") {
    head = `${head}, via the chair's courier`;
  }
  return head;
}

/**
 * What the caller is told. Never that the supervisor saw it — a registered row is a row, nothing more.
 * `reachedChat` says whether the line is in the chair's chat (`typed` or `queued`); the console voice
 * reads it, so a failed cmux hop is never spoken as "the supervisor has it".
 *
 * @param replayed whether this run found the turn already on the board and wrote nothing new
 * @param json whether the caller asked for the one-line document rather than the lines an operator reads
 * @param ruling what a reaction to a check-in came to, or `undefined` when the relay carried none
 * @param candidateRuling what a ruling on a workstream candidate came to, or `undefined` when the relay carried none
 * @returns the lines to write to stdout, in order
 */
export function relayReportLines({
  record,
  replayed,
  json,
  ruling,
  candidateRuling,
}: {
  record: TurnRecord;
  replayed: boolean;
  json: boolean;
  ruling: RulingOutcome | undefined;
  candidateRuling: CandidateRulingOutcome | undefined;
}): readonly string[] {
  if (json) {
    return [
      JSON.stringify({
        about: record.about,
        anchor: record.anchor,
        candidateRuling: candidateRulingField({ outcome: candidateRuling }),
        delivery: record.delivery,
        heard: record.heard,
        picture: record.picture,
        reachedChat: reachedSupervisorChat({ delivery: record.delivery }),
        readsAfter: record.readsAfter,
        registeredAtIso: record.registeredAtIso,
        replayed,
        ruling: rulingField({ ruling }),
        slug: record.slug,
        turnId: record.turnId,
        typed: record.typed,
        words: record.words,
        wordsAlone: record.wordsAlone,
      }),
    ];
  }
  const opening = replayed ? "already relayed" : "relayed";
  const lines = [`talk relay: ${opening} — ${record.slug} is on the board`];
  if (record.typed) {
    lines.push(`  their words, typed on the console: "${record.heard}"`);
  } else if (record.heard !== "") {
    lines.push(`  their words: "${record.heard}"`);
  }
  lines.push(`  the voice's reading: ${readingLine({ record })}`);
  lines.push(`  ${pictureClause({ picture: record.picture, typed: record.typed })}`);
  if (record.delivery !== null) {
    lines.push(`  supervisor chat: ${deliveryHead({ delivery: record.delivery })} — ${record.delivery.detail}`);
  }
  if (ruling?.kind === "recorded") {
    const { kind, place, settled } = ruling.ruling;
    lines.push(`  their word is now on ${String(settled.length)} check-in card(s): ${kind} in ${place}`);
  } else if (ruling?.kind === "refused") {
    lines.push(`  no ruling recorded — ${ruling.why}`);
  }
  const candidateLine = candidateRulingLine({ outcome: candidateRuling });
  if (candidateLine !== undefined) {
    lines.push(candidateLine);
  }
  lines.push("  a row on the board, nothing more — this does not mean the supervisor has seen it");
  return lines;
}

/** What became of the voice's reading on this turn, in the words the report prints after its label. */
function readingLine({ record }: { record: TurnRecord }): string {
  if (record.typed) {
    return "none — they typed it";
  }
  if (record.wordsAlone) {
    return "not carried — relayed with their words alone after a refusal";
  }
  if (record.readsAfter.length > 0) {
    return `dropped, only their words carried — ${droppedReadingWhy({ readsAfter: record.readsAfter })}`;
  }
  return record.words;
}
