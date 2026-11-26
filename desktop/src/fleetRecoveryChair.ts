/**
 * The supervisor's half of a Recovery result as the app shows it: the `chair` object `slopweaver fleet recover` prints
 * (`src/fleet/recoveryChair.ts`'s `RecoveryChairResult`), read strictly, and the lines it draws. Restated here because
 * this package cannot import `src/`, exactly as `./fleetRecoveryCheck.ts` restates the rest of the document. Pure.
 *
 * The chair's line comes first, since whether the supervisor runs is what a press is for; each chair the press opened
 * that did not take the pin follows it with its own reason, so a plan or vendor that fell back to the next says why.
 */
import { isRecord } from "./desktopBridge";

/** The two vendors a chair can be seated on. */
type ChairVendor = "claude" | "codex";

/** One chair the press opened, or tried to. */
export interface RecoveryChairRestart {
  readonly vendor: ChairVendor;
  readonly alias: string;
  readonly slug?: string;
  readonly sessionId?: string;
  readonly outcome: "restarted" | "starting" | "spawn-refused" | "ended" | "lost" | "deadline";
  readonly reason: string;
}

/** What the press did about the supervisor. */
export interface RecoveryChair {
  readonly outcome: "live" | "restarted" | "starting" | "not-restarted";
  readonly reason: string;
  readonly restarts: readonly RecoveryChairRestart[];
}

const CHAIR_VENDORS: readonly ChairVendor[] = ["claude", "codex"];
const CHAIR_OUTCOMES: readonly RecoveryChair["outcome"][] = ["live", "restarted", "starting", "not-restarted"];
const RESTART_OUTCOMES: readonly RecoveryChairRestart["outcome"][] = [
  "restarted",
  "starting",
  "spawn-refused",
  "ended",
  "lost",
  "deadline",
];

/** How each vendor is named in a line. */
const VENDOR_NAMES: Readonly<Record<ChairVendor, string>> = { claude: "Claude", codex: "Codex" };

/** A value when it is one of the allowed strings. */
function oneOf<T extends string>({ value, allowed }: { value: unknown; allowed: readonly T[] }): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/** The optional string fields of a restart, or `undefined` when one is present and not a string. */
function optionalIds({
  value,
}: {
  value: Record<string, unknown>;
}): Pick<RecoveryChairRestart, "sessionId" | "slug"> | undefined {
  const { sessionId, slug } = value;
  if ((sessionId !== undefined && typeof sessionId !== "string") || (slug !== undefined && typeof slug !== "string")) {
    return undefined;
  }
  return { ...(typeof slug === "string" ? { slug } : {}), ...(typeof sessionId === "string" ? { sessionId } : {}) };
}

/** One restart, read strictly. */
function parseRestart({ value }: { value: unknown }): RecoveryChairRestart | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const vendor = oneOf({ allowed: CHAIR_VENDORS, value: value["vendor"] });
  const outcome = oneOf({ allowed: RESTART_OUTCOMES, value: value["outcome"] });
  const { alias, reason } = value;
  const ids = optionalIds({ value });
  if (vendor === undefined || outcome === undefined || typeof alias !== "string" || typeof reason !== "string") {
    return undefined;
  }
  if (ids === undefined) {
    return undefined;
  }
  return { alias, outcome, reason, vendor, ...ids };
}

/**
 * The `chair` object, read strictly.
 *
 * @param value what the document carries under `chair`
 * @returns the chair, or `undefined` when it or any restart is malformed
 */
export function parseRecoveryChair({ value }: { value: unknown }): RecoveryChair | undefined {
  if (!isRecord(value) || !Array.isArray(value["restarts"])) {
    return undefined;
  }
  const outcome = oneOf({ allowed: CHAIR_OUTCOMES, value: value["outcome"] });
  const { reason } = value;
  if (outcome === undefined || typeof reason !== "string") {
    return undefined;
  }
  const restarts: RecoveryChairRestart[] = [];
  for (const element of value["restarts"]) {
    const restart = parseRestart({ value: element });
    if (restart === undefined) {
      return undefined;
    }
    restarts.push(restart);
  }
  return { outcome, reason, restarts };
}

/** What each chair outcome opens its line with. */
const CHAIR_OPENERS: Readonly<Record<RecoveryChair["outcome"], string>> = {
  live: "Supervisor: running",
  "not-restarted": "Supervisor: not restarted",
  restarted: "Supervisor: restarted",
  starting: "Supervisor: starting",
};

/**
 * The supervisor's lines: its outcome and reason, then every chair the press opened that fell back, with why.
 *
 * @param chair what the press did about the supervisor
 * @returns the lines, in order
 */
export function recoveryChairLines({ chair }: { chair: RecoveryChair }): string[] {
  const reason = `${chair.reason.charAt(0).toUpperCase()}${chair.reason.slice(1)}`;
  const lines = [`${CHAIR_OPENERS[chair.outcome]}. ${reason}`];
  for (const restart of chair.restarts.slice(0, -1)) {
    lines.push(`Tried ${VENDOR_NAMES[restart.vendor]} plan ${restart.alias} first: ${restart.reason}`);
  }
  return lines;
}
