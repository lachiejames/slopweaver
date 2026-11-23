/**
 * The forms and flag lists the `slopweaver slack draft` cases record with: card builders, the receipts declarations
 * and the record invocations every behaviour starts from.
 */
import type { OneCardArtifact } from "../../../../../../outbound/artifact/types.js";
import type { ParkedSlackDraft, SlackDraftEvent } from "../../../../../../outbound/slack/draftRegister.js";

/**
 * A one-card form of `n` one-run lines — the shape a parked as-me post takes — declaring no possible problem,
 * as every recording must declare one way or the other.
 *
 * It also declares the opening its first line already carries — the first half of its words as what it is, the
 * second as what it asks — because a top-level channel recording requires one. A first line under four words has no
 * two two-word halves, so it declares none: such a case records into a DM or a thread, which owe nothing.
 *
 * @returns the card
 */
export function oneCard({ lines }: { lines: readonly string[] }): OneCardArtifact {
  const words = lines[0]!.split(" ");
  const half = Math.ceil(words.length / 2);
  const opening = {
    asks: { kind: "reply" as const, text: words.slice(half).join(" ") },
    what: words.slice(0, half).join(" "),
  };
  return {
    kind: "one-card",
    lines: lines.map((text) => ({ runs: [{ text, type: "text" as const }] })),
    problem: { kind: "none" },
    ...(words.length >= 4 ? { opening } : {}),
  };
}

/**
 * A drip form, which is the multi-message shape a recorder must refuse.
 *
 * @returns the form as the JSON a recorder reads on stdin
 */
export function drip({ texts }: { texts: readonly string[] }): string {
  return JSON.stringify({ kind: "drip", messages: texts.map((text) => ({ runs: [{ text, type: "text" }] })) });
}

/**
 * The receipts declaration a recording whose form carries no link and no file owes (`outbound/slack/draftReceipts.ts`):
 * these test forms ask or tell rather than claim, so they say so.
 */
export const NO_CLAIM: readonly string[] = ["--self-evident", "a question, which claims nothing to check"];

/**
 * The proof a finding brings (`outbound/slack/findingProof.ts`): a screenshot, and the impact in
 * people whose count {@link PROVED_FINDING_LINES} leads with, beside the link that line carries.
 */
export const PROVED_FINDING: readonly string[] = [
  "--media",
  "/tmp/pool.png",
  "--impact",
  "12 users could not check out",
];

/** A finding's lines: the impact in people first, then the link to where the reader can see it. */
export const PROVED_FINDING_LINES: readonly string[] = [
  "12 users could not check out, the pool is exhausted",
  "https://grafana.example.com/d/pool",
];

/** A record invocation's flags, with the form on stdin, before any receipts declaration. */
export const RECORD_FLAGS: readonly string[] = [
  "record",
  "--channel",
  "C0ISO",
  "--form",
  "-",
  "--why",
  "the ISO group question",
  "--kind",
  "message",
  // The form asks a question, so the recording declares whether it was asked before.
  "--asked-before",
  "none",
];

/**
 * {@link RECORD_FLAGS} for a form carrying no link and no file, which declares so. It parks only where a first message's
 * proof is not owed (a DM or a thread reply): at the top level of a channel the same recording is refused for want of
 * a screenshot and a link, so a case recording there takes {@link RECORD_TAIL}.
 */
export const RECORD_UNPROVEN: readonly string[] = [...RECORD_FLAGS, ...NO_CLAIM];

/** The link a first message in a channel shows its reader: where they see the thing for themselves. */
const CONTROL_LINK = "https://app.vanta.com/c/1";

/**
 * The picture a first message in a channel owes (`outbound/slack/firstMessageProof.ts`): the fake
 * admission resolves an annotated, unobstructed record for every `.png` it reads, as `browser image-record` would.
 */
export const FIRST_MESSAGE_SHOT: readonly string[] = ["--media", "/tmp/control.png"];

/**
 * {@link RECORD_FLAGS} with the picture a first message in a channel owes; the form brings {@link shown}'s link. This is
 * the recording a case makes at the top level of #iso-27001 unless its subject is the proof itself.
 */
export const RECORD_TAIL: readonly string[] = [...RECORD_FLAGS, ...FIRST_MESSAGE_SHOT];

/**
 * {@link oneCard} with the link a first message in a channel owes, on a line of its own after `lines`.
 *
 * @param lines the card's lines, whose first sets the opening
 * @returns the card
 */
export function shown({ lines }: { lines: readonly string[] }): OneCardArtifact {
  const card = oneCard({ lines });
  return { ...card, lines: [...card.lines, { runs: [{ label: "the control", type: "link", url: CONTROL_LINK }] }] };
}

/** The line {@link shown} adds, as the message's text spells it. */
export const SHOWN_LINK_TEXT = `<${CONTROL_LINK}|the control>`;

/**
 * The one parked draft an append recorded.
 *
 * @returns the first parked draft among the events
 */
export function parkedIn({ events }: { events: readonly SlackDraftEvent[] }): ParkedSlackDraft {
  return events.flatMap((event) => (event.kind === "parked" ? [event.draft] : []))[0]!;
}
