/**
 * `slack poll results` — the PURE report half: what a live results read concluded, the lines a reader sees for
 * it, and the exit code it signals. No I/O, no clock, no Slack.
 */

import type { PollTally } from "../../../outbound/slack/pollResults.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/** What `poll results` concluded. Two outcomes, because live counting has only two real answers. */
export type PollResultOutcome =
  | { readonly kind: "counted"; readonly tally: PollTally }
  | { readonly kind: "gone" }
  | { readonly kind: "unknown-poll"; readonly unreadable: readonly string[] };

/** The counted body: per-option votes, the total, and everything not counted as a vote. */
function countedLines({ tally }: { tally: PollTally }): readonly string[] {
  const width = tally.options.reduce((max, option) => Math.max(max, option.label.length), 0);
  const rows = tally.options.map(
    (option) => `  ${String(option.position)}. ${option.label.padEnd(width)}  ${String(option.votes)}`,
  );
  const ignored =
    tally.ignored.length === 0
      ? []
      : [
          `  not on the ballot (NOT counted): ${tally.ignored
            .map((entry) => `:${entry.name}: x${String(entry.count)}`)
            .join(", ")}`,
        ];
  const truncated = tally.options.filter((option) => option.voterListTruncated);
  const truncatedNote =
    truncated.length === 0
      ? []
      : [
          `  NOTE: Slack truncated the voter list on option(s) ${truncated
            .map((option) => String(option.position))
            .join(", ")} — those counts came from the total rather than from who reacted.`,
        ];
  const unseeded = tally.options.filter((option) => !option.seeded);
  const seeding =
    unseeded.length === 0
      ? []
      : [
          `  NOTE: no seed chip on option(s) ${unseeded.map((option) => String(option.position)).join(", ")} — ` +
            "voters had to add that emoji themselves, so it may be under-represented.",
        ];
  return [
    ...rows,
    `  total votes: ${String(tally.totalVotes)}`,
    "  live from Slack, counted just now (slopweaver's own seed chips excluded).",
    ...truncatedNote,
    ...seeding,
    ...ignored,
  ];
}

/**
 * The human report for a results read.
 *
 * @param outcome what the read concluded
 * @param channel the poll's channel
 * @param ts the poll's message timestamp
 * @param question the stored question, when the poll is known
 * @param warnings any corpus read warnings
 * @returns the report lines, in display order
 */
export function pollResultLines({
  outcome,
  channel,
  ts,
  question,
  warnings,
}: {
  outcome: PollResultOutcome;
  channel: string;
  ts: string;
  question: string | undefined;
  warnings: readonly string[];
}): readonly string[] {
  const head = [`poll results — ${channel}:${ts}`, ...(question === undefined ? [] : [`  "${question}"`]), ""];
  const tail = warnings.map((warning) => `  warning: ${warning}`);
  if (outcome.kind === "counted") {
    return [...head, ...countedLines({ tally: outcome.tally }), ...tail];
  }
  if (outcome.kind === "gone") {
    return [
      ...head,
      "  GONE FROM SLACK — there is no message at that channel and timestamp, so there is nothing to count.",
      "  It was deleted, or the timestamp is wrong. This is NOT zero votes and is not reported as zero.",
      ...tail,
    ];
  }
  return [
    ...head,
    "  UNKNOWN POLL — slopweaver has no stored record for this message, so it does not know what the",
    "  options were and cannot say what any reaction means.",
    "  A poll carries no Slack metadata (the transport cannot attach it), so the local record is the only",
    "  place the ballot exists. If the poll was posted from another machine or home, read it there.",
    ...outcome.unreadable.map((entry) => `  unreadable poll record: ${entry}`),
    ...tail,
  ];
}

/**
 * The exit code for a results outcome: `counted` succeeds, every other outcome is a deliberate signal.
 *
 * @param outcome what the results read produced
 * @returns the exit code — a non-zero code here is a SIGNAL rather than a fault, so a caller can branch on
 *   "no votes yet" without treating it as a failure
 */
export function pollResultExit({ outcome }: { outcome: PollResultOutcome }): number {
  return outcome.kind === "counted" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}
