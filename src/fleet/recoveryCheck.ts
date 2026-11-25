/**
 * The pure half of `slopweaver fleet recover`: what one throwaway session is asked, what counts as it answering, which
 * plans are tried in what order, and the one result the verb prints.
 *
 * **A session at rest proves nothing.** A turn that errored ends `idle` exactly as a good one does, its error can
 * arrive as the agent's own text, and a session is `idle` before its first prompt too. So a pass is all three at once:
 * the session is idle, the last thing submitted to it is this check's own prompt, and what it last said is EXACTLY the
 * answer, which the prompt holds only in two separate halves — an echoed prompt, an error and an early idle all fail.
 *
 * **One bounded pass.** Each eligible plan is tried at most once, Claude's then Codex's, until one passes per vendor;
 * a plan routing excluded is reported with its reason and never launched. Nothing here retries.
 */
import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";

/** A vendor the check proves a turn on. */
export type RecoveryVendor = "claude" | "codex";

/** Both vendors, in the order they are checked and reported. */
export const RECOVERY_VENDORS: readonly RecoveryVendor[] = ["claude", "codex"];

/** The longest reason a result carries, in code points: one line a reader takes in at a glance. */
export const RECOVERY_REASON_MAX = 240;

/** How long one pass may go on opening sessions. The app kills the verb two minutes later. */
export const RECOVERY_PASS_MS = 12 * 60_000;

/** How long one throwaway session has to answer once its message is sent. */
export const RECOVERY_TURN_MS = 120_000;

/** The ledger key every throwaway session carries, followed by its run, vendor and plan. */
export const RECOVERY_KEY_PREFIX = "fleet-recovery:";

/** What a launch may take (the app's own prepare bound) plus the turn and the close after it. */
export const RECOVERY_ATTEMPT_MS = 180_000 + 60_000;

/** One plan a throwaway session may be opened on. */
export type RecoveryCandidate =
  | { readonly vendor: "claude"; readonly alias: string; readonly storeDir: string }
  | { readonly vendor: "codex"; readonly alias: string; readonly codexHome: string };

/** One registered plan routing would not spend, and whether signing it in is what would fix it. */
export interface RecoveryExclusion {
  readonly vendor: RecoveryVendor;
  readonly alias: string;
  readonly reason: string;
  /** The exact command a person runs to sign it in, when a sign-in is the step this plan is missing. */
  readonly signInCommand?: string;
}

/** What routing said about one vendor's plans: the ones it would spend, best first, and the ones it would not. */
export interface RecoveryEvidence {
  readonly vendor: RecoveryVendor;
  readonly candidates: readonly RecoveryCandidate[];
  readonly excluded: readonly RecoveryExclusion[];
  /** Why the vendor's plans could not be read at all, when they could not. */
  readonly unreadable?: string;
}

/** One throwaway session: the plan it opened on and what became of it. */
export interface RecoveryAttempt {
  readonly attemptId: string;
  readonly vendor: RecoveryVendor;
  readonly alias: string;
  /** The app's id for it, when a card was opened, so the app can join what its card says. */
  readonly sessionId?: string;
  readonly outcome: "passed" | "failed" | "deadline" | "launch-refused";
  readonly reason: string;
}

/** One vendor's line: whether a turn worked, on which plan, and why not otherwise. */
interface RecoveryVendorResult {
  readonly vendor: RecoveryVendor;
  readonly status: "passed" | "failed";
  /** The plan the turn worked on, when one did. */
  readonly alias?: string;
  readonly reason: string;
  /** The plans that were not tried, each with why. */
  readonly excluded: readonly { readonly alias: string; readonly reason: string }[];
}

/** The one step that would let a vendor start, when nothing did and a sign-in is the reason. */
export interface RecoverySignIn {
  readonly vendor: RecoveryVendor;
  readonly alias: string;
  readonly command: string;
}

/** The whole answer `fleet recover` prints, as one JSON line. */
export interface FleetRecoveryResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  /** `infrastructure-failed` is no verdict on either vendor: the check itself could not run or clean up. */
  readonly status: "passed" | "partial" | "failed" | "infrastructure-failed";
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  /** Exactly one entry per vendor, always. */
  readonly vendors: readonly RecoveryVendorResult[];
  readonly attempts: readonly RecoveryAttempt[];
  readonly signIn?: RecoverySignIn;
  /** Why the check itself could not run or clean up, when it could not. */
  readonly infrastructure?: string;
}

/**
 * One reason as a result carries it: one line, whitespace collapsed, at most {@link RECOVERY_REASON_MAX} code points.
 *
 * @param text the reason as it was given
 * @returns the bounded line
 */
export function boundedReason({ text }: { text: string }): string {
  const points = Array.from(text.replaceAll(/\s+/gu, " ").trim());
  if (points.length <= RECOVERY_REASON_MAX) {
    return points.join("");
  }
  return `${points.slice(0, RECOVERY_REASON_MAX - 1).join("")}…`;
}

/**
 * What one throwaway session is asked, and the only answer that passes. Two independent 128-bit halves sit apart in
 * the prompt and joined in the answer, so the answer is nowhere in what the session was sent.
 *
 * @param randomBytes the source of both halves
 * @returns the prompt to send and the exact text that passes
 */
export function recoveryChallenge({ randomBytes }: { randomBytes: (size: number) => Buffer }): {
  readonly prompt: string;
  readonly expected: string;
} {
  const first = randomBytes(16).toString("hex");
  const second = randomBytes(16).toString("hex");
  return {
    expected: `${first}${second}`,
    prompt:
      `Slopweaver recovery check. Use no tool and read no file. The first part is [${first}] and the second part is ` +
      `[${second}]. Reply with only the two parts joined: the first part directly followed by the second, with no ` +
      "brackets, spaces, punctuation or any other text.",
  };
}

/** What one look at a throwaway session says. */
export type RecoveryVerdict =
  | { readonly kind: "waiting" }
  | { readonly kind: "passed" }
  | { readonly kind: "failed" | "deadline"; readonly reason: string };

/** What a session that answered something else said, as a reason. */
function wrongAnswer({ said }: { said: string | undefined }): string {
  if (said === undefined || said.trim() === "") {
    return "its turn ended and it said nothing";
  }
  return boundedReason({ text: `its turn ended with another answer: ${said}` });
}

/**
 * Judge one look at a throwaway session against this module's three-part pass condition.
 *
 * @param snapshot the session as the app lists it now, or `undefined` when it lists no such session
 * @param prompt the exact text this check sent
 * @param expected the exact text that passes
 * @param deadlinePassed whether the attempt's time is up
 * @returns whether to keep waiting, that it passed, or why it did not
 */
export function judgeRecoverySnapshot({
  snapshot,
  prompt,
  expected,
  deadlinePassed,
}: {
  snapshot: Pick<AppSessionSnapshot, "lastAgentText" | "lastSubmittedText" | "state"> | undefined;
  prompt: string;
  expected: string;
  deadlinePassed: boolean;
}): RecoveryVerdict {
  if (snapshot === undefined) {
    return { kind: "failed", reason: "the app no longer lists the session" };
  }
  if (snapshot.state === "failed" || snapshot.state === "closed" || snapshot.state === "stopping") {
    return { kind: "failed", reason: `the session was ${snapshot.state} before it answered` };
  }
  if (snapshot.state === "idle" && snapshot.lastSubmittedText === prompt) {
    if (snapshot.lastAgentText?.trim() === expected) {
      return { kind: "passed" };
    }
    return { kind: "failed", reason: wrongAnswer({ said: snapshot.lastAgentText }) };
  }
  if (deadlinePassed) {
    return { kind: "deadline", reason: `it was still ${snapshot.state} when its time ran out` };
  }
  return { kind: "waiting" };
}

/** What identifies the login a candidate spends: two aliases over one store are one plan, tried once. */
function loginOf({ candidate }: { candidate: RecoveryCandidate }): string {
  if (candidate.vendor === "claude") {
    return candidate.storeDir;
  }
  return candidate.codexHome;
}

/**
 * One vendor's plans in the order routing ranked them, each login once.
 *
 * @param evidence what routing said about the vendor
 * @returns the plans to try, best first
 */
export function orderedRecoveryCandidates({ evidence }: { evidence: RecoveryEvidence }): readonly RecoveryCandidate[] {
  const seen = new Set<string>();
  return evidence.candidates.filter((candidate) => {
    const login = loginOf({ candidate });
    if (seen.has(login)) {
      return false;
    }
    seen.add(login);
    return true;
  });
}

/**
 * Whether one more session may be opened: what is left of the pass must hold a whole launch, turn and close.
 *
 * @param nowMs the instant now
 * @param startedMs when the pass began
 * @returns false once too little is left
 */
export function recoveryAttemptFits({ nowMs, startedMs }: { nowMs: number; startedMs: number }): boolean {
  return startedMs + RECOVERY_PASS_MS - nowMs >= RECOVERY_ATTEMPT_MS;
}

/** Why a vendor did not start: its last attempt, else its first excluded plan, else that it has none. */
function vendorFailure({
  evidence,
  attempts,
}: {
  evidence: RecoveryEvidence;
  attempts: readonly RecoveryAttempt[];
}): string {
  const last = attempts.at(-1);
  if (last !== undefined) {
    return boundedReason({ text: `${last.alias}: ${last.reason}` });
  }
  if (evidence.unreadable !== undefined) {
    return boundedReason({ text: `its plans could not be read: ${evidence.unreadable}` });
  }
  const [first] = evidence.excluded;
  if (first !== undefined) {
    return boundedReason({ text: `${first.alias}: ${first.reason}` });
  }
  return "no plan of it is registered";
}

/** One vendor's line, from what routing said and what its attempts did. */
function vendorResultOf({
  evidence,
  attempts,
}: {
  evidence: RecoveryEvidence;
  attempts: readonly RecoveryAttempt[];
}): RecoveryVendorResult {
  const excluded = evidence.excluded.map(({ alias, reason }) => ({ alias, reason: boundedReason({ text: reason }) }));
  const own = attempts.filter((attempt) => attempt.vendor === evidence.vendor);
  const passed = own.find((attempt) => attempt.outcome === "passed");
  if (passed !== undefined) {
    return { alias: passed.alias, excluded, reason: passed.reason, status: "passed", vendor: evidence.vendor };
  }
  return {
    excluded,
    reason: vendorFailure({ attempts: own, evidence }),
    status: "failed",
    vendor: evidence.vendor,
  };
}

/**
 * The one sign-in step that would fix it: the first excluded plan whose missing step IS a sign-in, Claude's before
 * Codex's. Only positive evidence of a missing sign-in names one — a paused plan, a limit or an attempt that failed
 * some other way never does, and nothing is named while any vendor started.
 *
 * @param evidence what routing said about every vendor
 * @param attempts what the throwaway sessions did
 * @returns the step, or `undefined`
 */
export function recoverySignInStep({
  evidence,
  attempts,
}: {
  evidence: readonly RecoveryEvidence[];
  attempts: readonly RecoveryAttempt[];
}): RecoverySignIn | undefined {
  if (attempts.some((attempt) => attempt.outcome === "passed")) {
    return undefined;
  }
  for (const exclusion of evidence.flatMap((vendor) => vendor.excluded)) {
    if (exclusion.signInCommand !== undefined) {
      return { alias: exclusion.alias, command: exclusion.signInCommand, vendor: exclusion.vendor };
    }
  }
  return undefined;
}

/** The overall status: every vendor, some, or none. */
function statusOf({
  vendors,
  infrastructure,
}: {
  vendors: readonly RecoveryVendorResult[];
  infrastructure: string | undefined;
}): FleetRecoveryResult["status"] {
  if (infrastructure !== undefined) {
    return "infrastructure-failed";
  }
  const passed = vendors.filter((vendor) => vendor.status === "passed").length;
  if (passed === vendors.length) {
    return "passed";
  }
  if (passed > 0) {
    return "partial";
  }
  return "failed";
}

/** What routing said about one vendor, or that nothing was read of it. */
function evidenceFor({
  vendor,
  evidence,
}: {
  vendor: RecoveryVendor;
  evidence: readonly RecoveryEvidence[];
}): RecoveryEvidence {
  const read = evidence.find((entry) => entry.vendor === vendor);
  if (read === undefined) {
    return { candidates: [], excluded: [], unreadable: "the check stopped before reading them", vendor };
  }
  return read;
}

/**
 * The result of one whole pass.
 *
 * @param runId the pass
 * @param startedAtIso when it began
 * @param finishedAtIso when it ended
 * @param evidence what routing said about each vendor it was asked about
 * @param attempts every session the pass opened, in order
 * @param infrastructure why the check itself could not run or clean up, when it could not
 * @returns the result, with exactly one entry per vendor
 */
export function recoveryResultOf({
  runId,
  startedAtIso,
  finishedAtIso,
  evidence,
  attempts,
  infrastructure,
}: {
  runId: string;
  startedAtIso: string;
  finishedAtIso: string;
  evidence: readonly RecoveryEvidence[];
  attempts: readonly RecoveryAttempt[];
  infrastructure: string | undefined;
}): FleetRecoveryResult {
  const vendors = RECOVERY_VENDORS.map((vendor) =>
    vendorResultOf({ attempts, evidence: evidenceFor({ evidence, vendor }) }),
  );
  const signIn = recoverySignInStep({ attempts, evidence });
  return {
    attempts,
    finishedAtIso,
    runId,
    schemaVersion: 1,
    startedAtIso,
    status: statusOf({ infrastructure, vendors }),
    vendors,
    ...(signIn === undefined ? {} : { signIn }),
    ...(infrastructure === undefined ? {} : { infrastructure: boundedReason({ text: infrastructure }) }),
  };
}
