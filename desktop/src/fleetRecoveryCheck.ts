/**
 * The Recovery check as the app shows it: the one document `slopweaver fleet recover` prints, read strictly; the
 * press's state, which lets one pass run at a time; and the lines the Sessions page and the menu bar draw. Pure.
 *
 * The check opens one visible throwaway Claude card, then one Codex card, each closed again
 * (`src/fleet/recoveryPass.ts`). The owner starts it by pressing Recovery, in the menu bar or on the Sessions page,
 * and nothing else does: no launch, no timer, no calendar. The wire shape is the CLI's `FleetRecoveryResult`
 * (`src/fleet/recoveryCheck.ts`), restated here because this package cannot import `src/`, the way `fleetHealth.ts`
 * restates `fleet health`'s.
 *
 * Success is read from that document alone. The verb exits 1 or 3 beside a perfectly good result, so its exit code
 * decides nothing, and the verb promises exactly one stdout line, so a second line is a broken contract rather than
 * noise to skip.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";
import { type FleetRecoveryError, FleetRecoveryErrors } from "./errors";

/** The two vendors a pass checks, in the order it checks them. */
export type RecoveryVendor = "claude" | "codex";

/** One vendor's verdict: the plan that worked, or why none did. */
export interface RecoveryVendorResult {
  readonly vendor: RecoveryVendor;
  readonly status: "passed" | "failed";
  readonly alias?: string;
  readonly reason: string;
}

/** One throwaway card a pass opened, or tried to. */
export interface RecoveryAttempt {
  readonly vendor: RecoveryVendor;
  readonly alias: string;
  /** Set once the app reported a session for the card; a card that opened can still fail the check. */
  readonly sessionId?: string;
  readonly outcome: "passed" | "failed" | "deadline" | "launch-refused";
  readonly reason: string;
}

/** The one command that signs a plan back in, when a signed-out plan is why nothing started. */
export interface RecoverySignIn {
  readonly vendor: RecoveryVendor;
  readonly alias: string;
  readonly command: string;
}

/** What one pass found: the fields of the CLI's document the app reads. */
export interface FleetRecoveryResult {
  readonly status: "passed" | "partial" | "failed" | "infrastructure-failed";
  readonly vendors: readonly RecoveryVendorResult[];
  readonly attempts: readonly RecoveryAttempt[];
  readonly signIn?: RecoverySignIn;
  readonly infrastructure?: string;
}

/** Where the Recovery check stands. Memory only: the app opens on `idle`. */
export type FleetRecoveryState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "result"; readonly result: FleetRecoveryResult }
  | { readonly kind: "no-result"; readonly error: FleetRecoveryError };

/** What happened to the check. */
export type FleetRecoveryEvent =
  | { readonly kind: "pressed" }
  | { readonly kind: "finished"; readonly result: FleetRecoveryResult }
  | { readonly kind: "no-result"; readonly error: FleetRecoveryError };

/** The state after an event, and whether that event starts a pass. */
export interface FleetRecoveryStep {
  readonly state: FleetRecoveryState;
  readonly run: boolean;
}

/** What the page and the menu draw for a state. */
export interface FleetRecoveryPresentation {
  readonly headline: string;
  readonly lines: readonly string[];
  /** Whether a press would start a pass: false while one runs, so the button and the menu item go quiet. */
  readonly canRun: boolean;
}

/** The state the app opens on: nothing checked, nothing running. */
export const RECOVERY_IDLE: FleetRecoveryState = { kind: "idle" };

const VENDORS: readonly RecoveryVendor[] = ["claude", "codex"];
const RESULT_STATUSES: readonly FleetRecoveryResult["status"][] = [
  "passed",
  "partial",
  "failed",
  "infrastructure-failed",
];
const VENDOR_STATUSES: readonly RecoveryVendorResult["status"][] = ["passed", "failed"];
const OUTCOMES: readonly RecoveryAttempt["outcome"][] = ["passed", "failed", "deadline", "launch-refused"];

/** How each vendor is named in a line. */
const VENDOR_NAMES: Readonly<Record<RecoveryVendor, string>> = { claude: "Claude", codex: "Codex" };

/**
 * A value when it is one of the allowed strings.
 *
 * @returns the value, or `undefined` for anything else
 */
function oneOf<T extends string>({ value, allowed }: { value: unknown; allowed: readonly T[] }): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/**
 * Whether an optional string field is present as something other than a string. Absent is fine.
 *
 * @returns true when the field is there and malformed
 */
function badOptional({ record, key }: { record: Record<string, unknown>; key: string }): boolean {
  const value = record[key];
  return value !== undefined && typeof value !== "string";
}

/**
 * One vendor's verdict, read strictly.
 *
 * @returns the verdict, or `undefined` when any field is malformed
 */
function parseVendor({ value }: { value: unknown }): RecoveryVendorResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const vendor = oneOf({ allowed: VENDORS, value: value["vendor"] });
  const status = oneOf({ allowed: VENDOR_STATUSES, value: value["status"] });
  const { alias, reason } = value;
  if (
    vendor === undefined ||
    status === undefined ||
    typeof reason !== "string" ||
    badOptional({ key: "alias", record: value })
  ) {
    return undefined;
  }
  return { reason, status, vendor, ...(typeof alias === "string" ? { alias } : {}) };
}

/**
 * One attempt, read strictly.
 *
 * @returns the attempt, or `undefined` when any field is malformed
 */
function parseAttempt({ value }: { value: unknown }): RecoveryAttempt | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const vendor = oneOf({ allowed: VENDORS, value: value["vendor"] });
  const outcome = oneOf({ allowed: OUTCOMES, value: value["outcome"] });
  const { alias, reason, sessionId } = value;
  const wellFormed =
    vendor !== undefined && outcome !== undefined && typeof alias === "string" && typeof reason === "string";
  if (!wellFormed || badOptional({ key: "sessionId", record: value })) {
    return undefined;
  }
  return { alias, outcome, reason, vendor, ...(typeof sessionId === "string" ? { sessionId } : {}) };
}

/**
 * The sign-in hint, read strictly when present.
 *
 * @returns the hint to spread in, `{}` when absent, or `undefined` when malformed
 */
function parseSignIn({ value }: { value: unknown }): { readonly signIn?: RecoverySignIn } | undefined {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const vendor = oneOf({ allowed: VENDORS, value: value["vendor"] });
  const { alias, command } = value;
  if (vendor === undefined || typeof alias !== "string" || typeof command !== "string") {
    return undefined;
  }
  return { signIn: { alias, command, vendor } };
}

/**
 * Each element of a list, read with `parse`, or `undefined` when the value is not a list or any element is malformed.
 *
 * @returns the elements, in order
 */
function parseList<T>({
  value,
  parse,
}: {
  value: unknown;
  parse: (options: { value: unknown }) => T | undefined;
}): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed: T[] = [];
  for (const element of value) {
    const one = parse({ value: element });
    if (one === undefined) {
      return undefined;
    }
    parsed.push(one);
  }
  return parsed;
}

/**
 * Whether the verdicts name each vendor exactly once.
 *
 * @returns true for one Claude verdict and one Codex verdict
 */
function oneVerdictPerVendor({ vendors }: { vendors: readonly RecoveryVendorResult[] }): boolean {
  return (
    vendors.length === VENDORS.length && VENDORS.every((vendor) => vendors.some((entry) => entry.vendor === vendor))
  );
}

/**
 * The fields of a parsed document past its envelope.
 *
 * @returns the result, or which field was malformed
 */
function parseBody({ value }: { value: Record<string, unknown> }): Result<FleetRecoveryResult, FleetRecoveryError> {
  const status = oneOf({ allowed: RESULT_STATUSES, value: value["status"] });
  if (status === undefined) {
    return err(FleetRecoveryErrors.unreadable({ field: "status" }));
  }
  const vendors = parseList({ parse: parseVendor, value: value["vendors"] });
  if (vendors === undefined || !oneVerdictPerVendor({ vendors })) {
    return err(FleetRecoveryErrors.unreadable({ field: "vendors" }));
  }
  const attempts = parseList({ parse: parseAttempt, value: value["attempts"] });
  if (attempts === undefined) {
    return err(FleetRecoveryErrors.unreadable({ field: "attempts" }));
  }
  const signIn = parseSignIn({ value: value["signIn"] });
  if (signIn === undefined) {
    return err(FleetRecoveryErrors.unreadable({ field: "signIn" }));
  }
  const { infrastructure } = value;
  if (badOptional({ key: "infrastructure", record: value })) {
    return err(FleetRecoveryErrors.unreadable({ field: "infrastructure" }));
  }
  return ok({
    attempts,
    status,
    vendors,
    ...signIn,
    ...(typeof infrastructure === "string" ? { infrastructure } : {}),
  });
}

/**
 * The result off what `fleet recover` printed on stdout: exactly one non-empty line, holding a schema-1 document
 * that names each vendor once. Its exit code is not read.
 *
 * @param text everything the verb printed on stdout
 * @returns the result, or which part of it was malformed
 */
export function parseFleetRecovery({ text }: { text: string }): Result<FleetRecoveryResult, FleetRecoveryError> {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length !== 1) {
    return err(FleetRecoveryErrors.unreadable({ field: `the output (${String(lines.length)} lines, not one)` }));
  }
  let value: unknown;
  try {
    value = JSON.parse(lines[0]!);
  } catch {
    return err(FleetRecoveryErrors.unreadable({ field: "the output (not JSON)" }));
  }
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return err(FleetRecoveryErrors.unreadable({ field: "schemaVersion" }));
  }
  return parseBody({ value });
}

/**
 * Apply one event. A press starts a pass unless one is running, whichever surface it came from, so a second press,
 * or a stale page's link firing again, starts nothing.
 *
 * @param state where the check stands
 * @param event what happened
 * @returns the next state, and whether to start a pass now
 */
export function stepFleetRecovery({
  state,
  event,
}: {
  state: FleetRecoveryState;
  event: FleetRecoveryEvent;
}): FleetRecoveryStep {
  if (event.kind === "pressed") {
    if (state.kind === "running") {
      return { run: false, state };
    }
    return { run: true, state: { kind: "running" } };
  }
  if (event.kind === "finished") {
    return { run: false, state: { kind: "result", result: event.result } };
  }
  return { run: false, state: { error: event.error, kind: "no-result" } };
}

/**
 * One vendor's line, read off its verdict alone: the plan it started a session on when it passed, else that it did
 * not pass and the verb's own reason. Only a passed verdict says "started a session" — a card that opened and never
 * answered failed the check, and the line must not read like a pass to someone glancing at it.
 *
 * @returns the sentence
 */
function vendorLine({ verdict }: { verdict: RecoveryVendorResult }): string {
  const name = VENDOR_NAMES[verdict.vendor];
  if (verdict.status === "passed") {
    return `${name} started a session on ${verdict.alias === undefined ? "a plan" : `plan ${verdict.alias}`}.`;
  }
  return `${name} did not pass: ${verdict.reason}`;
}

/** Each pass status's headline. */
const RESULT_HEADLINES: Readonly<Record<FleetRecoveryResult["status"], string>> = {
  failed: "Recovery check: neither Claude nor Codex can start a session.",
  "infrastructure-failed": "Recovery check: the check itself could not run.",
  partial: "Recovery check: only one vendor can start a session.",
  passed: "Recovery check: Claude and Codex can both start a session.",
};

/**
 * The lines one finished pass draws: a verdict per vendor, then the check's own failure and the sign-in command
 * when it printed them.
 *
 * @returns the lines, in order
 */
function resultLines({ result }: { result: FleetRecoveryResult }): string[] {
  const lines = VENDORS.map((vendor) => result.vendors.find((entry) => entry.vendor === vendor)!).map((verdict) =>
    vendorLine({ verdict }),
  );
  if (result.infrastructure !== undefined) {
    lines.push(`What stopped it: ${result.infrastructure}`);
  }
  if (result.signIn !== undefined) {
    lines.push(`To sign ${result.signIn.alias} back in, run ${result.signIn.command}`);
  }
  return lines;
}

/**
 * What the page and the menu show for a state.
 *
 * @param state where the check stands
 * @returns the headline, the lines under it, and whether a press would start a pass
 */
export function fleetRecoveryPresentation({ state }: { state: FleetRecoveryState }): FleetRecoveryPresentation {
  if (state.kind === "idle") {
    return { canRun: true, headline: "Recovery check: not run since the app opened.", lines: [] };
  }
  if (state.kind === "running") {
    return { canRun: false, headline: "Recovery check: checking Claude, then Codex…", lines: [] };
  }
  if (state.kind === "no-result") {
    return { canRun: true, headline: "Recovery check: no result.", lines: [state.error.message] };
  }
  return {
    canRun: true,
    headline: RESULT_HEADLINES[state.result.status],
    lines: resultLines({ result: state.result }),
  };
}
