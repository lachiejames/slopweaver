/**
 * The closed words of a Queue triage pass: the owner's verdict on one card and the inbox-zero label beside it. The
 * pass gives each card a clock to either say it needs more info, or is ready to go out, or should be
 * parked for a working session, or parked for the slow triage hour, and the labels are the Gmail ones the owner once
 * ran inbox zero on: waiting on them, waiting on me, come back to it, action now. A card the owner cannot understand
 * is dropped and rewritten from their feedback, so `rewrite` is a verdict too.
 *
 * `drop` is the owner's "no": a first live pass had nowhere to put "just close the PR, I don't actually want this
 * anymore", and it was stored as `send-it` — the one verdict a yes reads as a send.
 *
 * Shared by `relay_steer`'s schema (`./steerToolSchemas.ts`), `talk relay --triage --label` and the row's text, so a
 * word the voice may pass is a word the verb accepts and the row spells; `site/lib/triageWords.ts` restates the two
 * lists, since `site/` cannot import `src/`.
 */

/** The owner's verdict on one card in a triage pass. */
export const TRIAGE_VERDICTS = [
  "send-it",
  "needs-more-info",
  "park-working-session",
  "park-slow-triage",
  "rewrite",
  "drop",
] as const;

/** One verdict. */
export type TriageVerdict = (typeof TRIAGE_VERDICTS)[number];

/** The inbox-zero label beside a verdict. */
export const TRIAGE_LABELS = ["waiting-on-them", "waiting-on-me", "come-back-to-it", "action-now"] as const;

/** One label. */
export type TriageLabel = (typeof TRIAGE_LABELS)[number];

/**
 * What was wrong with a card the owner sent back, named as a class so a repeat can be COUNTED rather than read out of
 * prose: five cards drawing the same feedback, such as missing receipts, should make a general ruling. `no-receipts`
 * is a claim with no link or screenshot behind it; `not-at-a-glance` is a card the owner could not read in the two
 * minutes a triage pass gives it.
 */
export const TRIAGE_FEEDBACK = ["no-receipts", "not-at-a-glance"] as const;

/** One feedback class. */
export type TriageFeedback = (typeof TRIAGE_FEEDBACK)[number];

/** The verdicts that send a card back, the only ones feedback rides beside. */
export const FEEDBACK_VERDICTS: readonly TriageVerdict[] = ["needs-more-info", "rewrite"];

/** The owner's triage ruling on one card, as a relay carries it. */
export interface TriageRuling {
  readonly verdict: TriageVerdict;
  readonly label: TriageLabel | undefined;
  /** What was wrong with the card, when the owner sent it back for a named class of defect. */
  readonly feedback?: TriageFeedback | undefined;
}

/**
 * Each verdict as the row says it to the supervisor, naming what it asks of the fleet. The owner's words land on the
 * card and take it off their Queue (`landRelayCard`), so a parked card is put back below the rest rather than lost —
 * the owner has seen it, and a park is a place for it, never a close — and a rewritten one is put back where the pass will find it.
 */
const VERDICT_WORDS: Readonly<Record<TriageVerdict, string>> = {
  drop: "drop it — the owner does not want this; nothing goes out on it: drop or close what the card proposes",
  "needs-more-info": "needs more info — find what is missing and put it on the card",
  "park-slow-triage":
    "park it for the slow triage hour — no act now; the owner's Queue already draws the card parked below the rest, so settle this row and never talk restore it",
  "park-working-session":
    "park it for a working session with the owner — no act now; the owner's Queue already draws the card parked below the rest, so settle this row and never talk restore it",
  rewrite:
    "rewrite this card from the owner's words, it did not read — rewrite it and put it back on the owner's Queue (talk restore) now: the owner's triage pass brings it back to them first as soon as it is back",
  "send-it": "send it — it is ready to go out as the card stands",
};

/** Each label in the owner's words. */
const LABEL_WORDS: Readonly<Record<TriageLabel, string>> = {
  "action-now": "action now",
  "come-back-to-it": "come back to it",
  "waiting-on-me": "waiting on me",
  "waiting-on-them": "waiting on them",
};

/** Each feedback class as the row says it to the supervisor. */
const FEEDBACK_WORDS: Readonly<Record<TriageFeedback, string>> = {
  "no-receipts": "it made a claim with no receipt — no link to where the owner can see it, no screenshot of it",
  "not-at-a-glance": "it did not read at a glance",
};

/**
 * Whether a value is one of the feedback classes.
 *
 * @param value anything
 * @returns `true` for a feedback class
 */
export function isTriageFeedback(value: unknown): value is TriageFeedback {
  return TRIAGE_FEEDBACK.some((one) => one === value);
}

/**
 * Whether a value is one of the verdicts.
 *
 * @param value anything
 * @returns `true` for a verdict
 */
export function isTriageVerdict(value: unknown): value is TriageVerdict {
  return TRIAGE_VERDICTS.some((one) => one === value);
}

/**
 * Whether a value is one of the labels.
 *
 * @param value anything
 * @returns `true` for a label
 */
export function isTriageLabel(value: unknown): value is TriageLabel {
  return TRIAGE_LABELS.some((one) => one === value);
}

/**
 * The line a relay row carries for the owner's triage ruling, so the supervisor reads the verdict even when the
 * voice's reading of it was dropped after a read and the owner's own words were only "yep, do that".
 *
 * @param ruling the verdict and label the relay carries
 * @returns one line naming both
 */
export function triageRulingLine({ ruling }: { ruling: TriageRuling }): string {
  const label = ruling.label === undefined ? "" : ` Label: ${LABEL_WORDS[ruling.label]}.`;
  const feedback = ruling.feedback === undefined ? "" : ` What was wrong: ${FEEDBACK_WORDS[ruling.feedback]}.`;
  return `The owner's triage verdict on this card: ${VERDICT_WORDS[ruling.verdict]}.${label}${feedback}`;
}

/**
 * A relay row's ask with the owner's triage ruling after it, when the relay carries one; the ask unchanged otherwise, so a
 * relay with no ruling digests exactly as one did before triage rode it (`./relayDraft.ts`).
 *
 * @param ask the ask as the steer's own words formed it
 * @param triageRuling the owner's verdict and label on the card the pass had open
 * @param held whether the relay's words may stop short (`./relayCutHold.ts`), so the verdict rides marked NOT APPLIED
 * @returns the ask the row carries
 */
export function withTriageRuling({
  ask,
  triageRuling,
  held = false,
}: {
  ask: string;
  triageRuling: TriageRuling | undefined;
  held?: boolean;
}): string {
  if (triageRuling === undefined) {
    return ask;
  }
  if (held) {
    return `${ask} — NOT APPLIED, the words may stop short of a no: ${triageRulingLine({ ruling: triageRuling })}`;
  }
  return `${ask} — ${triageRulingLine({ ruling: triageRuling })}`;
}
