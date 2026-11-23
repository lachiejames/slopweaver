/**
 * The Alignment page's voice section: what the fleet has learnt about how the owner writes from the Slack messages they sent,
 * drawn as a profile and never asked as questions: once Slack is connected, it can read every message the owner has
 * sent and build a voice rule profile from them, so asking questions is the poorer way. Nothing here takes an answer.
 *
 * Two reads, kept apart on the page because they are different facts:
 *
 * - **Measured from the owner's Slack** — the measured length register (`profile voice --json`): per Slack cohort, the median,
 *   75th and 90th percentile word counts and how many sent messages they were measured over. Only a cohort with a
 *   measured median is a measurement; the register's own `—` reads as not measured, never as zero.
 * - **Rules the owner set** — the bans the send door enforces (`slack voice-rules --json`), labelled as theirs, never as
 *   learnt.
 *
 * Which of three the section draws is {@link voiceProfileOf}'s decision: Slack not connected (the designed empty state
 * with Slack's connect step), connected with nothing measured yet, or the profile. Pure, so the unit lane holds it.
 *
 * **Nothing here infers anything; a Slack refresh measures the register.** Every refresh whose Slack ingest succeeds
 * counts the words of the messages the owner typed and writes these cohorts (`profile voice measure`, `src/profile/`), so the
 * page says "measured", never "inferred", and between connecting Slack and that first refresh it says what fills it.
 */

/** As much of a measured cohort as the profile reads — the console's `VoiceCohort` fits. */
export interface CohortInput {
  readonly surface: string;
  readonly cohort: string;
  readonly medianWords: number | undefined;
  readonly p75Words: number | undefined;
  readonly p90Words: number | undefined;
  readonly sampleCount: number | undefined;
  readonly measuredAt: string;
}

/** As much of the voice rules as the profile reads — the console's `VoiceRules` fits. */
export interface RulesInput {
  readonly rules: readonly { readonly kind: string; readonly value: string }[];
}

/**
 * The Slack surfaces the register measures the owner's sent messages on, in the order the profile lists them. Each
 * label names the surface only: which of their messages a cohort covers is the cohort's own name, which the basis line
 * carries, so a narrow cohort (one calibrated against a single colleague) is never shown as everything they send.
 */
const SLACK_SURFACES = [
  { label: "Slack", surface: "slack" },
  { label: "Slack DMs", surface: "slack-dm" },
] as const;

/** One Slack surface's measured lengths, in the words the page prints. */
export interface VoiceLength {
  /** Which messages, said plainly. */
  readonly label: string;
  /** The spread, in whole sentences: half under the median, three in four under p75, nine in ten under p90. */
  readonly spread: string;
  /** What it was measured over, and when. */
  readonly basis: string;
}

/** What the voice section draws. */
export type VoiceProfileView =
  | { readonly kind: "not-connected" }
  | { readonly kind: "not-measured" }
  | { readonly kind: "measured"; readonly lengths: readonly VoiceLength[] };

/**
 * A date as the page prints it, `D Mon YYYY`.
 *
 * @returns the day, month and year, or the string as given when it does not parse
 */
function dayOf({ iso }: { iso: string }): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  return new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" });
}

/**
 * The cohort a surface is described by: the one with a measured median and the largest stated sample, the rule the
 * send door's length check uses (`src/outbound/voice/lengthRegister.ts` `cohortForSurface`), so the page describes
 * the same cohort the door warns against.
 *
 * @returns the cohort, or `undefined` when nothing measured a median on that surface
 */
function measuredCohortOf({
  cohorts,
  surface,
}: {
  cohorts: readonly CohortInput[];
  surface: string;
}): (CohortInput & { readonly medianWords: number }) | undefined {
  let best: (CohortInput & { readonly medianWords: number }) | undefined;
  for (const cohort of cohorts) {
    const { medianWords } = cohort;
    if (cohort.surface !== surface || medianWords === undefined) {
      continue;
    }
    const sample = cohort.sampleCount;
    const bestSample = best?.sampleCount;
    if (best === undefined || (sample !== undefined && (bestSample === undefined || sample > bestSample))) {
      best = { ...cohort, medianWords };
    }
  }
  return best;
}

/**
 * One surface's lengths as the page prints them.
 *
 * @returns the label, the spread and what it was measured over
 */
function lengthOf({
  cohort,
  label,
}: {
  cohort: CohortInput & { readonly medianWords: number };
  label: string;
}): VoiceLength {
  const parts = [`Half are under ${String(cohort.medianWords)} words`];
  if (cohort.p75Words !== undefined) {
    parts.push(`3 in 4 under ${String(cohort.p75Words)}`);
  }
  if (cohort.p90Words !== undefined) {
    parts.push(`9 in 10 under ${String(cohort.p90Words)}`);
  }
  let over = "your sent messages";
  if (cohort.sampleCount !== undefined) {
    over = `${String(cohort.sampleCount)} of your sent messages`;
  }
  return {
    basis: `Measured over ${over} in the "${cohort.cohort}" cohort on ${dayOf({ iso: cohort.measuredAt })}.`,
    label,
    spread: `${parts.join(", ")}.`,
  };
}

/**
 * What the voice section draws. Slack known not connected draws the connect empty state, whatever the register holds,
 * since the voice is learnt from Slack and the owner has not connected it; a connection that could not be checked is not
 * "not connected", so it falls through to what the register says.
 *
 * @param cohorts the measured register, as read
 * @param slackConnected whether a Slack token is present, `undefined` while that cannot be told
 * @returns the view
 */
export function voiceProfileOf({
  cohorts,
  slackConnected,
}: {
  cohorts: readonly CohortInput[];
  slackConnected: boolean | undefined;
}): VoiceProfileView {
  // A register already measured is what fills the section, whether or not Slack is still connected: a removed token
  // stops the next measurement, never the last one.
  const lengths = SLACK_SURFACES.flatMap(({ label, surface }) => {
    const cohort = measuredCohortOf({ cohorts, surface });
    return cohort === undefined ? [] : [lengthOf({ cohort, label })];
  });
  if (lengths.length > 0) {
    return { kind: "measured", lengths };
  }
  if (slackConnected === false) {
    return { kind: "not-connected" };
  }
  return { kind: "not-measured" };
}

/**
 * Which Slack connect step the voice section draws. `connect` replaces the section: Slack is known not connected and
 * nothing measured is there to show, including while the register has not read. `reconnect` sits above a
 * measured profile: a removed token stops the next measurement, and the section must say so rather than read as
 * current. An unread preflight (`undefined`) is a stale mark, never "disconnected", so it draws `none`.
 *
 * @param view what {@link voiceProfileOf} decided, `undefined` while the register has not read
 * @param tokenPresent the Slack preflight's answer, `undefined` while it has none
 * @returns the step
 */
export function voiceSlackStepOf({
  view,
  tokenPresent,
}: {
  view: VoiceProfileView | undefined;
  tokenPresent: boolean | undefined;
}): "connect" | "reconnect" | "none" {
  if (view?.kind === "not-connected") {
    return "connect";
  }
  if (tokenPresent !== false) {
    return "none";
  }
  if (view?.kind === "measured") {
    return "reconnect";
  }
  return "connect";
}

/**
 * Whether the register holds a measured Slack cohort — what the page's indicator calls the owner's voice measured.
 *
 * @param cohorts the measured register, as read
 * @returns true when at least one Slack surface carries a measured median
 */
export function voiceMeasuredOf({ cohorts }: { cohorts: readonly CohortInput[] }): boolean {
  return SLACK_SURFACES.some(({ surface }) => measuredCohortOf({ cohorts, surface }) !== undefined);
}

/**
 * How a banned value reads on the page: a dash by name, since a lone dash in a list reads as punctuation.
 *
 * @returns the value as the page shows it
 */
function banLabel({ value }: { value: string }): string {
  if (/^—$/u.test(value)) {
    return "em-dashes";
  }
  if (value.trim() === "--") {
    return "“--”";
  }
  return `“${value}”`;
}

/**
 * The bans the send door enforces on anything written as the owner, each as the page names it.
 *
 * @param rules the owner's voice rules
 * @returns one label per ban, in the rules' order
 */
export function voiceBansOf({ rules }: { rules: RulesInput }): readonly string[] {
  return rules.rules.map((rule) => banLabel({ value: rule.value }));
}
