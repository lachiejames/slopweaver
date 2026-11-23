/**
 * The WAKE a parked seat carries — what brings a seat that closed itself on a clock or on CI back, and whether
 * that is due now. Pure: the clock and the provider read arrive as arguments.
 *
 * No session should stay open that is not doing work. Idle seats are otherwise kept open BY DESIGN: a repair seat sleeping to a recipe's next firing, a stack seat on review watches.
 * `../cmux/backgroundWork.ts` counts any background shell as work, because a footer count cannot tell a `sleep` from
 * a build. So the seat says what it waits on instead: `handover park --wake-at <iso>` or `--wake-on-checks
 * <owner/repo>#<n>` journals the wake on its `parked` checkpoint and closes the workspace, and `handover wake`, a
 * supervisor-tick reading, reseats it by a visible `cmux spawn` once due. A seat landing its OWN pull request keeps
 * its seat through CI instead, and the park refuses that wake (`./ownLandingPark.ts`).
 *
 * An optional FIELD on `parked`, never a new event kind: every checkout reads the one shared home, and an older
 * decoder drops a field it does not know while an unknown kind makes ownership ambiguous
 * (`.claude/rules/area-handover.md`). An older reader sees an ordinary park and simply never wakes it.
 */
import { createHash } from "node:crypto";

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GithubChecksSnapshot, isChecksTerminal, summarizeChecks } from "../live/github/checks.js";
import type { GithubLiveError } from "../live/github/errors.js";

/** What a parked seat waits on: an instant, or one pull request's CI reaching a verdict. */
export type ParkWake =
  | { readonly kind: "at"; readonly atIso: string }
  | { readonly kind: "checks"; readonly repo: string; readonly number: number };

/** One read of the pull request a checks wake names: closed, merged at a commit, or open with its head's checks. */
export type ChecksWakeObservation =
  | { readonly prState: "CLOSED" }
  | { readonly prState: "MERGED"; readonly mergeCommitOid: string }
  | { readonly prState: "OPEN"; readonly checks: GithubChecksSnapshot };

/** The one provider read a checks wake makes. */
export type ReadChecksWake = (args: {
  repo: string;
  number: number;
}) => Promise<Result<ChecksWakeObservation, GithubLiveError>>;

/**
 * WHAT a due wake saw — the condition a reseat acts on, so a later park on the same condition can be told apart from
 * one on a new one. A clock is its instant. A checks wake carries its target, so two different merged pull requests
 * never compare equal, and an open one its head and a digest of every check on it ({@link checksWakeFingerprint}).
 */
export type WakeObservation =
  | { readonly kind: "at"; readonly atIso: string }
  | {
      readonly kind: "checks";
      readonly repo: string;
      readonly number: number;
      readonly prState: "CLOSED" | "MERGED";
    }
  | {
      readonly kind: "checks";
      readonly repo: string;
      readonly number: number;
      readonly prState: "OPEN";
      readonly headSha: string;
      readonly fingerprint: string;
    };

/**
 * Whether a wake is due — UNKNOWN when the read that would say could not be had, which never wakes a seat. A due
 * MERGED read carries its merge commit beside the observation, never in it: the observation is journalled and
 * compared, while the commit is what a removed worktree's finish must find in the tree it probes.
 */
export type ParkWakeJudgement =
  | {
      readonly kind: "due";
      readonly reason: string;
      readonly observed: WakeObservation;
      readonly mergeCommitOid?: string;
    }
  | { readonly kind: "not-due"; readonly reason: string }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * A digest of one head's checks that changes whenever any of them is a different RUN: the head, then every check's
 * kind, name, state, conclusion, Actions run, details URL and the instant GitHub dated that run, sorted so the read's
 * order is irrelevant. A re-run of failed jobs on the same head mints new check runs, a re-run Check Run another app
 * posted a new `completedAt` and a re-posted Status a new `createdAt`, so each is a new
 * condition even when it ends exactly as red. Every run the read discarded as a duplicate of a name counts too, since
 * a re-run the parser kept out of `checks` is still a new run.
 *
 * Residue: a run GitHub dated nothing, with no run id and no URL, carries no instance id at all, so its re-run reads
 * as the same condition.
 *
 * @param checks the snapshot one read of the head produced
 * @returns a hex sha256
 */
export function checksWakeFingerprint({ checks }: { checks: GithubChecksSnapshot }): string {
  const kept = checks.checks.map((check) =>
    JSON.stringify(
      [check.kind, check.name, check.state, check.conclusion, check.runId, check.url, check.datedAt].map(String),
    ),
  );
  const superseded = checks.supersededChecks.map((check) =>
    JSON.stringify(
      ["superseded", check.kind, check.name, check.state, check.conclusion, check.runId, check.completedAt].map(String),
    ),
  );
  const lines = [...kept, ...superseded].toSorted();
  return createHash("sha256")
    .update([checks.headSha, ...lines].join("\n"), "utf8")
    .digest("hex");
}

/**
 * Whether two observations name the same condition — same instant, or same pull request in the same state, and for
 * an open one the same head and the same checks.
 *
 * @returns true when a reseat on `left` already acted on `right`
 */
export function sameWakeObservation({ left, right }: { left: WakeObservation; right: WakeObservation }): boolean {
  return observationKey({ observed: left }) === observationKey({ observed: right });
}

/**
 * One string per distinct condition, every field in a fixed order. An instant keys by its millisecond value, so
 * a bare-seconds instant and the same instant with milliseconds are one condition; text that is no instant keys as itself.
 */
function observationKey({ observed }: { observed: WakeObservation }): string {
  if (observed.kind === "at") {
    const atMs = parseStrictIsoInstantMs({ text: observed.atIso });
    if (atMs === undefined) {
      return JSON.stringify(["at-text", observed.atIso]);
    }
    return JSON.stringify(["at", atMs]);
  }
  const target = [observed.repo, String(observed.number), observed.prState];
  return JSON.stringify(observed.prState === "OPEN" ? [...target, observed.headSha, observed.fingerprint] : target);
}

/** `owner/name#N` — one slash, one hash, no whitespace, a positive pull-request number. */
const CHECKS_TARGET = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)$/u;

/** `owner/name` alone, as the journal stores it. */
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/**
 * Whether a text names one UTC instant: strict ISO-8601 ending in `Z`, so an offset is never silently moved.
 *
 * @param text the candidate
 * @returns true when it is exactly one UTC instant
 */
export function isUtcInstant({ text }: { text: string }): boolean {
  return text.endsWith("Z") && parseStrictIsoInstantMs({ text }) !== undefined;
}

/**
 * Whether a text is a repository slug as a checks wake stores it.
 *
 * @param text the candidate
 * @returns true for `owner/name`
 */
export function isRepoSlug({ text }: { text: string }): boolean {
  return REPO_SLUG.test(text);
}

/** Both wake flags were given; a park waits on one thing. */
export interface WakeFlagsExclusiveError {
  readonly code: "WAKE_FLAGS_EXCLUSIVE";
  readonly message: string;
}

/** `--wake-at` named something other than one UTC instant. */
export interface WakeAtInvalidError {
  readonly code: "WAKE_AT_INVALID";
  readonly message: string;
  readonly value: string;
}

/** `--wake-on-checks` named something other than one `owner/name#N`. */
export interface WakeTargetInvalidError {
  readonly code: "WAKE_TARGET_INVALID";
  readonly message: string;
  readonly value: string;
}

/** Why `handover park`'s wake flags were refused. */
export type ParkWakeError = WakeFlagsExclusiveError | WakeAtInvalidError | WakeTargetInvalidError;

/** The one place each {@link ParkWakeError} is built. */
export const ParkWakeErrors = {
  /** @returns the refusal of both flags at once */
  exclusive: (): WakeFlagsExclusiveError => ({
    code: "WAKE_FLAGS_EXCLUSIVE",
    message: "--wake-at and --wake-on-checks are mutually exclusive: a park waits on one thing",
  }),
  /** @returns the refusal naming the instant that did not read */
  wakeAtInvalid: ({ value }: { value: string }): WakeAtInvalidError => ({
    code: "WAKE_AT_INVALID",
    message: `--wake-at "${value}" is not one UTC instant (YYYY-MM-DDTHH:MM:SSZ)`,
    value,
  }),
  /** @returns the refusal naming the target that did not read */
  wakeTargetInvalid: ({ value }: { value: string }): WakeTargetInvalidError => ({
    code: "WAKE_TARGET_INVALID",
    message: `--wake-on-checks "${value}" is not owner/name#N`,
    value,
  }),
} as const;

/**
 * The wake `handover park`'s two flags name — mutually exclusive, each refused when it does not parse.
 *
 * @param wakeAt the `--wake-at` value, a UTC instant ending in `Z`
 * @param wakeOnChecks the `--wake-on-checks` value, `owner/name#N`
 * @returns the wake, `undefined` when neither flag was given, or the reason it was refused
 */
export function parseParkWake({
  wakeAt,
  wakeOnChecks,
}: {
  wakeAt: string | undefined;
  wakeOnChecks: string | undefined;
}): Result<ParkWake | undefined, ParkWakeError> {
  if (wakeAt !== undefined && wakeOnChecks !== undefined) {
    return err(ParkWakeErrors.exclusive());
  }
  if (wakeAt !== undefined) {
    return isUtcInstant({ text: wakeAt })
      ? ok({ atIso: wakeAt, kind: "at" })
      : err(ParkWakeErrors.wakeAtInvalid({ value: wakeAt }));
  }
  if (wakeOnChecks !== undefined) {
    const match = CHECKS_TARGET.exec(wakeOnChecks);
    const number = Number(match?.[2]);
    if (match === null || !Number.isSafeInteger(number)) {
      return err(ParkWakeErrors.wakeTargetInvalid({ value: wakeOnChecks }));
    }
    return ok({ kind: "checks", number, repo: match[1]! });
  }
  return ok(undefined);
}

/**
 * Decode a journalled `wake`. Anything not exactly one well-formed wake is dropped rather than coerced, so a
 * hand-edited or malformed line parks the seat with no wake instead of waking it at a guessed time.
 *
 * @param raw the field as the journal line holds it
 * @returns the wake, or `undefined` when the line carries none that reads
 */
export function decodeParkWake({ raw }: { raw: unknown }): ParkWake | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const wake: Readonly<Record<string, unknown>> = { ...raw };
  const keys = Object.keys(wake).toSorted().join(",");
  const { atIso, kind, number, repo } = wake;
  if (kind === "at" && keys === "atIso,kind" && typeof atIso === "string" && isUtcInstant({ text: atIso })) {
    return { atIso, kind };
  }
  const wellFormedChecks =
    kind === "checks" &&
    keys === "kind,number,repo" &&
    typeof repo === "string" &&
    isRepoSlug({ text: repo }) &&
    typeof number === "number" &&
    Number.isSafeInteger(number) &&
    number > 0;
  return wellFormedChecks ? { kind, number, repo } : undefined;
}

/**
 * Whether a wake is due at `now`. A clock wake is due at or after its instant. A checks wake is due once the
 * pull request merged or closed, or its head's checks all reached a terminal state — RED included, because a
 * failed build is exactly what the seat must come back to fix. A partial read or a failed one is UNKNOWN.
 *
 * @param wake the wake the checkpoint carries
 * @param now the instant of this judgement
 * @param readChecks the one provider read a checks wake makes
 * @returns the judgement and the reason a line prints
 */
export async function judgeParkWake({
  wake,
  now,
  readChecks,
}: {
  wake: ParkWake;
  now: Date;
  readChecks: ReadChecksWake;
}): Promise<ParkWakeJudgement> {
  if (wake.kind === "at") {
    const atMs = parseStrictIsoInstantMs({ text: wake.atIso });
    if (atMs === undefined) {
      return { kind: "unknown", reason: `the wake instant "${wake.atIso}" does not read` };
    }
    return now.getTime() >= atMs
      ? { kind: "due", observed: wake, reason: `its wake time ${wake.atIso} has passed` }
      : { kind: "not-due", reason: `it wakes at ${wake.atIso}` };
  }
  const target = `${wake.repo}#${String(wake.number)}`;
  const read = await readChecks({ number: wake.number, repo: wake.repo });
  if (read.isErr()) {
    return { kind: "unknown", reason: `${target} could not be read: ${read.error.message}` };
  }
  const observation = read.value;
  const { number, repo } = wake;
  if (observation.prState !== "OPEN") {
    return {
      kind: "due",
      ...(observation.prState === "MERGED" ? { mergeCommitOid: observation.mergeCommitOid } : {}),
      observed: { kind: "checks", number, prState: observation.prState, repo },
      reason: `${target} is ${observation.prState}`,
    };
  }
  if (observation.checks.truncated) {
    return {
      kind: "unknown",
      reason: `${target}'s checks did not fully read (${observation.checks.residue.join("; ")}), so none is proven done`,
    };
  }
  const summary = summarizeChecks({ checks: observation.checks.checks });
  if (!isChecksTerminal({ summary })) {
    return {
      kind: "not-due",
      reason: `${target} has ${String(summary.running)} running and ${String(summary.queued)} queued check(s)`,
    };
  }
  const { checks } = observation;
  return {
    kind: "due",
    observed: {
      fingerprint: checksWakeFingerprint({ checks }),
      headSha: checks.headSha,
      kind: "checks",
      number,
      prState: "OPEN",
      repo,
    },
    reason: `${target}'s checks finished: ${String(summary.passed)} passed, ${String(summary.failed)} failed`,
  };
}

/**
 * How a row names what its parked seat waits on.
 *
 * @returns e.g. `until <iso instant>` or `on CI for <owner/repo>#<n>`
 */
export function parkWakePhrase({ wake }: { wake: ParkWake }): string {
  return wake.kind === "at" ? `until ${wake.atIso}` : `on CI for ${wake.repo}#${String(wake.number)}`;
}
