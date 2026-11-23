/**
 * The owner's triage verdicts, inbox-zero labels and feedback classes, as the page carries them from `relay_steer` to `talk
 * relay --triage --label --feedback`. Restated from `src/talk/triageVocabulary.ts` because a file under `site/` never imports `src/`;
 * `site/__tests__/unit/triageWordsMirror.test.ts` binds the copy.
 */

/** The owner's verdicts on a triage card, `rewrite` being the one for a card they could not follow and `drop` their "no". */
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

/** The owner's inbox-zero labels. */
export const TRIAGE_LABELS = ["waiting-on-them", "waiting-on-me", "come-back-to-it", "action-now"] as const;

/** One label. */
export type TriageLabel = (typeof TRIAGE_LABELS)[number];

/** The classes of defect the owner names on a card they send back, which a repeat turns into a ruling candidate. */
export const TRIAGE_FEEDBACK = ["no-receipts", "not-at-a-glance"] as const;

/** One class of feedback. */
export type TriageFeedback = (typeof TRIAGE_FEEDBACK)[number];

/** The verdicts that send a card back, the only ones feedback rides beside. */
export const FEEDBACK_VERDICTS: readonly TriageVerdict[] = ["needs-more-info", "rewrite"];

/** The verdicts that park a card: it stays the owner's, drawn below the rest. */
const PARK_VERDICTS: ReadonlySet<TriageVerdict> = new Set(["park-working-session", "park-slow-triage"]);

/**
 * Whether the owner's ruling on a card parks it. Any other verdict, a `rewrite` riding on a recut included, is not a park, so
 * it never sorts, speaks or counts as one.
 *
 * @param verdict the owner's verdict, `undefined` when none was given
 * @returns true only for a park verdict
 */
export function parksTheCard({ verdict }: { verdict: TriageVerdict | undefined }): boolean {
  return verdict !== undefined && PARK_VERDICTS.has(verdict);
}

/** The owner's ruling on the card a triage pass has open: a verdict, a label when one was given, and what was wrong when named. */
export interface TriageRulingWire {
  readonly verdict: TriageVerdict;
  readonly label: TriageLabel | undefined;
  readonly feedback?: TriageFeedback | undefined;
}

/** Each verdict as the Queue's pill names it: a park says where it went, so a card below the rest says why. */
const VERDICT_PILL: Readonly<Record<TriageVerdict, string>> = {
  drop: "Drop",
  "needs-more-info": "Needs more info",
  "park-slow-triage": "Parked, slow triage hour",
  "park-working-session": "Parked, working session",
  rewrite: "Rewrite",
  "send-it": "Send it",
};

/** Each label as the Queue's pill names it, in the owner's words. */
const LABEL_PILL: Readonly<Record<TriageLabel, string>> = {
  "action-now": "action now",
  "come-back-to-it": "come back to it",
  "waiting-on-me": "waiting on me",
  "waiting-on-them": "waiting on them",
};

/**
 * The owner's triage ruling as the pill a Queue row draws: the verdict, then the inbox-zero label when one was given.
 *
 * @param triage the owner's verdict, and the label given beside it
 * @returns the pill's words, as "Parked, working session · waiting on them"
 */
export function triagePillWords({
  triage,
}: {
  triage: { readonly verdict: TriageVerdict; readonly label?: TriageLabel };
}): string {
  if (triage.label === undefined) {
    return VERDICT_PILL[triage.verdict];
  }
  return `${VERDICT_PILL[triage.verdict]} · ${LABEL_PILL[triage.label]}`;
}

/**
 * The verdict a value names, or `undefined` when it names none.
 *
 * @param value anything a body or a tool call carried
 * @returns the verdict, or `undefined`
 */
export function triageVerdictOf({ value }: { value: unknown }): TriageVerdict | undefined {
  return TRIAGE_VERDICTS.find((one) => one === value);
}

/**
 * The label a value names, or `undefined` when it names none.
 *
 * @param value anything a body or a tool call carried
 * @returns the label, or `undefined`
 */
export function triageLabelOf({ value }: { value: unknown }): TriageLabel | undefined {
  return TRIAGE_LABELS.find((one) => one === value);
}

/**
 * The feedback class a value names, or `undefined` when it names none.
 *
 * @param value anything a body or a tool call carried
 * @returns the class, or `undefined`
 */
export function triageFeedbackOf({ value }: { value: unknown }): TriageFeedback | undefined {
  return TRIAGE_FEEDBACK.find((one) => one === value);
}

/**
 * Why a feedback value cannot ride beside a verdict, or `undefined` when it can or none was given: a class of the owner's, and
 * only beside a verdict that sends the card back.
 *
 * @param feedback the raw feedback value a body or a tool call carried
 * @param verdict the verdict it rides beside
 * @returns the refusal sentence, or `undefined`
 */
export function feedbackRefusal({
  feedback,
  verdict,
}: {
  feedback: unknown;
  verdict: TriageVerdict;
}): string | undefined {
  if (feedback === undefined) {
    return undefined;
  }
  if (triageFeedbackOf({ value: feedback }) === undefined) {
    return `feedback must be one of ${TRIAGE_FEEDBACK.join(", ")}`;
  }
  if (!FEEDBACK_VERDICTS.includes(verdict)) {
    return `feedback names what to fix on a sent-back card, so it rides only beside ${FEEDBACK_VERDICTS.join(" or ")}`;
  }
  return undefined;
}
