/**
 * What one `slopweaver supervisor chair-watch` pass concluded about the pinned chair: whether it stays, hands off,
 * is held by the owner, could not be measured, or sits on a host the control plane cannot hand off from — with every
 * reason, the successor's target, every plan reading it judged on, and the overrides that change the outcome.
 *
 * This is the contract between the watch (`../cli/commands/supervisor/chairWatchPass.ts`, the effectful read) and the
 * hand-off transaction (`./chairHandOff.ts`), which acts ONLY on a `hand-off` report it re-read itself. The model never
 * decides whether to hand off: this report does, and the model supplies the note.
 *
 * It names plan ALIASES and readings only, never an account address, organisation or store path, in its human lines
 * and its JSON both: a watch report is printed to a terminal and journalled.
 *
 * Pure: types and the one status rule.
 */
import type { ChairSuccessorTarget } from "./chairSuccessor.js";

/** What the watch concluded. */
export type ChairWatchStatus = "stay" | "hand-off" | "held" | "unmeasured" | "unsupported";

/** Where the watch found the chair. */
export type ChairWatchChair =
  | { readonly kind: "app"; readonly appSessionId: string; readonly sessionIds: readonly string[] }
  | { readonly kind: "cmux"; readonly workspaceId: string; readonly sessionIds: readonly string[] }
  | { readonly kind: "codex"; readonly threadId: string }
  | { readonly kind: "unresolved"; readonly why: string };

/** One plan the watch judged on, as recorded — never a live probe — with its instant. */
export interface ChairWatchReading {
  readonly alias: string;
  readonly vendor: "claude" | "codex";
  /** `measured` inside the freshness window, `stale` past it (kept, never judged on), `none` when nothing was recorded. */
  readonly state: "measured" | "stale" | "none" | "not-measured";
  /** The reading as one phrase of aliases, percentages and instants, e.g. `week 44%, Fable week 71%`. */
  readonly reading: string;
  readonly observedAtIso?: string;
  /** Whether a chair session spends this plan. */
  readonly chair: boolean;
}

/** One session's usage as the watch read it: the model it asked for against the one that ran, and its rate. */
export interface ChairWatchSessionUsage {
  readonly sessionId: string;
  readonly plan?: string;
  readonly askedModel?: string;
  readonly ranModel?: string;
  /** Set when the asked and ran models differ, naming both. */
  readonly mismatch?: string;
  readonly tokensPerHour?: number;
}

/** The usage watch: per session, and per plan across every session on it, never added to the model host's own total. */
export interface ChairWatchUsage {
  readonly sessions: readonly ChairWatchSessionUsage[];
  readonly plans: readonly { readonly alias: string; readonly appTokens: number; readonly modelHostReading?: string }[];
  /** Why a half could not be read (the app unreachable, say); empty when both were. */
  readonly gaps: readonly string[];
}

/** The owner's standing hold on automatic hand-off, when one is in force. */
export interface ChairWatchHold {
  readonly reason: string;
  readonly sinceIso: string;
}

/** One watch pass. */
export interface ChairWatchReport {
  readonly observedAtIso: string;
  readonly status: ChairWatchStatus;
  readonly chair: ChairWatchChair;
  /** Every reason the cadence named, one line each, already rendered (`./chairCadenceLines.ts` `reasonLine`). */
  readonly reasons: readonly string[];
  /** Where the successor boots and on which plan, present on `hand-off` and `held`. */
  readonly successor?: { readonly target: ChairSuccessorTarget; readonly alias?: string };
  readonly readings: readonly ChairWatchReading[];
  /** What could not be measured, and anything else the cadence noted. */
  readonly notes: readonly string[];
  readonly hold?: ChairWatchHold;
  /** Each way the owner can change this outcome, as a command line. */
  readonly overrides: readonly string[];
  readonly usage: ChairWatchUsage;
}

/**
 * The status one pass reports, from the cadence's own conclusion, the host the chair sits on and the owner's hold.
 *
 * Order matters and is the rule: an unmeasured chair is never handed off, a chair the control plane cannot message
 * `later` (a cmux tab) is `unsupported` rather than `hand-off`, and a hold outranks a hand-off verdict but is
 * reported beside it, so the owner sees what the hold is holding back.
 *
 * @param cadence `stay`, `hand-off`, or `unmeasured` when the cadence could not judge the chair
 * @param chair where the watch found the chair
 * @param hold the owner's standing hold, when one is in force
 * @returns the status
 */
export function chairWatchStatus({
  cadence,
  chair,
  hold,
}: {
  cadence: "stay" | "hand-off" | "unmeasured";
  chair: ChairWatchChair;
  hold: ChairWatchHold | undefined;
}): ChairWatchStatus {
  if (cadence === "unmeasured" || chair.kind === "unresolved") {
    return "unmeasured";
  }
  if (cadence === "stay") {
    return "stay";
  }
  if (chair.kind !== "app") {
    return "unsupported";
  }
  if (hold !== undefined) {
    return "held";
  }
  return "hand-off";
}

/** An email-shaped token: a plan's account address, which no line this control plane writes may carry. */
const ADDRESS = /[^\s@<>()"'`,;:]+@[^\s@<>()"'`,;:]+\.[A-Za-z]{2,}/gu;

/**
 * A line with every account address replaced, for a sentence the control plane composes from a read it did not
 * write: a register failure, the watch's reasons, a nested verb's failure. The readings already name aliases only;
 * this holds that true of the report, the journal and the doc even when an input does not.
 *
 * @param text the line
 * @returns the line, each address replaced by `<account>`
 */
export function withoutAddresses({ text }: { text: string }): string {
  return text.replaceAll(ADDRESS, "<account>");
}

/** One session's usage with its free text scrubbed. */
function sessionUsageWithoutAddresses({ session }: { session: ChairWatchSessionUsage }): ChairWatchSessionUsage {
  return {
    ...session,
    ...(session.plan === undefined ? {} : { plan: withoutAddresses({ text: session.plan }) }),
    ...(session.askedModel === undefined ? {} : { askedModel: withoutAddresses({ text: session.askedModel }) }),
    ...(session.ranModel === undefined ? {} : { ranModel: withoutAddresses({ text: session.ranModel }) }),
    ...(session.mismatch === undefined ? {} : { mismatch: withoutAddresses({ text: session.mismatch }) }),
  };
}

/** The usage watch with every gap, session string and model-host reading scrubbed. */
function usageWithoutAddresses({ usage }: { usage: ChairWatchUsage }): ChairWatchUsage {
  const scrub = (text: string): string => withoutAddresses({ text });
  return {
    gaps: usage.gaps.map(scrub),
    plans: usage.plans.map((plan) => ({
      ...plan,
      ...(plan.modelHostReading === undefined ? {} : { modelHostReading: scrub(plan.modelHostReading) }),
    })),
    sessions: usage.sessions.map((session) => sessionUsageWithoutAddresses({ session })),
  };
}

/**
 * The report with every free-text line passed through {@link withoutAddresses}: the reasons, the notes, the
 * overrides, each reading's phrase, the owner's hold reason, the usage watch's gaps, session models and model-host
 * readings, an unresolved chair's reason and a successor no host can take. Those carry text from reads the watch did
 * not write — a register failure can quote the row it refused, and a hold reason is whatever the owner typed — so
 * the scrub sits at the one place the report is assembled, and both the human lines and `--json` print what it left.
 *
 * @param report the report as assembled
 * @returns the same report, its free text without addresses
 */
export function reportWithoutAddresses({ report }: { report: ChairWatchReport }): ChairWatchReport {
  const scrub = (text: string): string => withoutAddresses({ text });
  let chair = report.chair;
  if (chair.kind === "unresolved") {
    chair = { kind: "unresolved", why: scrub(chair.why) };
  }
  let successor = report.successor;
  if (successor?.target.kind === "none") {
    successor = { ...successor, target: { kind: "none", why: scrub(successor.target.why) } };
  }
  const { hold } = report;
  return {
    ...report,
    chair,
    notes: report.notes.map(scrub),
    overrides: report.overrides.map(scrub),
    readings: report.readings.map((reading) => ({ ...reading, reading: scrub(reading.reading) })),
    reasons: report.reasons.map(scrub),
    usage: usageWithoutAddresses({ usage: report.usage }),
    ...(hold === undefined ? {} : { hold: { ...hold, reason: scrub(hold.reason) } }),
    ...(successor === undefined ? {} : { successor }),
  };
}
