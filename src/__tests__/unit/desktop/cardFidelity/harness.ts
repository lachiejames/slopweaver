/*
 * What the card-fidelity judge's split test files share: the synthetic acme fixture card, the owner's typed challenge, the
 * console's answer for that card, the instant and entry builders a call file is made of, and the one GOOD call most
 * cases start from. It moved here when the judge's one test file was split by behaviour.
 */
import type { CallEntry } from "../../../../talk/callRecord.js";

/** A synthetic card, never this install's own: the acme organisation's fixture ask. */
export const KEY = "ask:acme-fixture-card";
export const CHALLENGE = "E2E typed abc123: I don't think that problem is real. What does the card actually claim?";
export const BRIEFING = "/home/acme/.slopweaver/pages/acme-fixture/index.html";

/** The console's `{ card, links }` answer for the fixture card. */
export const ANSWER: string = JSON.stringify({
  card: {
    boardSlug: "acme-fixture-card",
    ifSilent: "the export stays paused",
    key: KEY,
    lean: "approve the retry",
    options: [
      { letter: "A", sentence: "Retry the nightly export once" },
      { letter: "B", sentence: "Leave the warehouse sync paused" },
    ],
    problem: "The nightly export failed 3 times since Tuesday.",
    question: "Should the fleet retry the export?",
    what: "an export job",
  },
  links: { files: [BRIEFING], pages: [] },
});

/**
 * The instant `seconds` after the call opened.
 *
 * @returns the ISO-8601 UTC instant that many seconds past the fixture's fixed call-open instant
 */
export const at = ({ seconds }: { seconds: number }): string =>
  new Date(Date.UTC(2026, 10, 2, 5, 0, seconds)).toISOString();

/**
 * One final segment.
 *
 * @returns a final `segment` call entry spoken by `who` at that offset
 */
export const said = ({
  id,
  who,
  s,
  text,
}: {
  id: string;
  who: "owner" | "voice";
  s: number;
  text: string;
}): CallEntry => ({
  atIso: at({ seconds: s }),
  final: true,
  id,
  kind: "segment",
  text,
  who,
});

/**
 * One tool line.
 *
 * @returns an unrefused `tool` call entry, carrying the tool's answer only when one was kept
 */
export const tool = ({
  s,
  name,
  detail,
  answer,
}: {
  s: number;
  name: string;
  detail: string;
  answer?: string;
}): CallEntry => ({
  atIso: at({ seconds: s }),
  detail,
  kind: "tool",
  name,
  refused: false,
  ...(answer === undefined ? {} : { answer }),
});

/** The first answer: quotes the question, carries the problem and both options. */
export const FAITHFUL: string =
  "The card asks: Should the fleet retry the export? The nightly export failed 3 times since Tuesday. Option A is " +
  "to retry the nightly export once; option B leaves the warehouse sync paused.";

/** A call where the card is read, the briefing read, answered, challenged and re-read, then answered well. */
export const GOOD: readonly CallEntry[] = [
  said({ id: "h1", s: 0, text: "Please open my Queue card acme fixture card.", who: "owner" }),
  tool({ answer: ANSWER, detail: `${KEY}, read`, name: "read_card", s: 2 }),
  tool({ answer: '{"slug":"acme-fixture-card"}', detail: "read with board_row", name: "board_row", s: 3 }),
  tool({
    answer: "<html>briefing</html>",
    detail: "read ~/.slopweaver/pages/acme-fixture/index.html",
    name: "file_read",
    s: 4,
  }),
  said({ id: "v1", s: 6, text: FAITHFUL, who: "voice" }),
  said({ id: "h2", s: 20, text: CHALLENGE, who: "owner" }),
  tool({ answer: ANSWER, detail: `${KEY}, read`, name: "read_card", s: 21 }),
  said({
    id: "v2",
    s: 23,
    text: "Reading it again, the card says the export failed 3 times. The card does not say why, and I have not checked the logs.",
    who: "voice",
  }),
];
