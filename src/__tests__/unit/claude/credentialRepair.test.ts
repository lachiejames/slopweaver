import { describe, expect, it } from "vitest";

import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import {
  assessStoreRefresh,
  assessStoreRepair,
  refusedAlias,
  type StoreLife,
  type StoreRefreshOutcome,
  type StoreRepairSkipReason,
  signInOnlyRepairSkipMeaning,
} from "../../../claude/credentialRepair.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { err, ok } from "../../../lib/result.js";

const NOW = "2026-09-12T06:00:00.000Z";
const EXPIRED = "2026-09-12T05:45:00.000Z";
const ALIVE = "2026-09-12T14:00:00.000Z";
const GRANT_ALIVE = "2026-10-11T12:00:12.000Z";
const GRANT_DEAD = "2026-09-01T12:00:12.000Z";

const gauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: ALIVE, status: "allowed", utilization: 0.2 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: ALIVE, status: "allowed", utilization: 0.3 },
});

const spentGauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: ALIVE, status: "rejected", utilization: 1 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: ALIVE, status: "rejected", utilization: 1 },
});

/** An expired store with a live refresh grant — the one shape that earns an attempt. */
const repairable = (over: Partial<StoreLife> = {}): StoreLife => ({
  alias: "plan-two",
  expiresAtIso: EXPIRED,
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: GRANT_ALIVE,
  ...over,
});

const refused = err(ClaudeRotationErrors.credentialRejected({ alias: "plan-two", status: 401 }));

/**
 * The problem off a FAILED outcome, so no assertion carries a conditional (`.claude/rules/testing.md`).
 *
 * It stands in the same relation to `StoreRefreshOutcome` that `unwrap` does to a `Result`: the caller asserts
 * the discriminant first, and this narrows without a ternary inside an `expect`.
 */
const failedProblem = ({ outcome }: { outcome: StoreRefreshOutcome }): string =>
  outcome.status === "failed" ? outcome.problem : "NOT A FAILURE — the outcome reported a refresh";

describe("refusedAlias", () => {
  it("names the alias for a CREDENTIAL_REJECTED reading", () => {
    expect(refusedAlias({ reading: refused })).toBe("plan-two");
  });

  it("answers undefined for a successful reading, for a transport failure and for a shape change", () => {
    // It reads `code` and never a message. The old probe flattened all three of these into one `problem`
    // string, so telling them apart downstream meant matching text — which is how a dead network would have
    // become one refresh command per store per spawn.
    expect(refusedAlias({ reading: ok(gauge({ alias: "plan-two" })) })).toBe(undefined);
    expect(refusedAlias({ reading: err(ClaudeRotationErrors.probeTransportFailed({ alias: "plan-two" })) })).toBe(
      undefined,
    );
    expect(refusedAlias({ reading: err(ClaudeRotationErrors.usageShapeChanged({ field: "x" })) })).toBe(undefined);
  });
});

describe("assessStoreRepair attempts exactly one shape", () => {
  it("attempts a refused store whose access token has expired and whose grant is alive", () => {
    const life = repairable();
    expect(assessStoreRepair({ current: life, nowIso: NOW, probed: life, reading: refused })).toStrictEqual({
      kind: "attempt",
    });
  });

  it("attempts a store whose access expiry is exactly now, since the CLI's window is already open", () => {
    const life = repairable({ expiresAtIso: NOW });
    expect(assessStoreRepair({ current: life, nowIso: NOW, probed: life, reading: refused })).toStrictEqual({
      kind: "attempt",
    });
  });

  it("attempts when the grant expires one millisecond from now", () => {
    const life = repairable({ refreshExpiresAtIso: "2026-09-12T06:00:00.001Z" });
    expect(assessStoreRepair({ current: life, nowIso: NOW, probed: life, reading: refused })).toStrictEqual({
      kind: "attempt",
    });
  });
});

describe("assessStoreRepair runs NO command for anything that is not a credential refusal", () => {
  it("skips a successful reading", () => {
    const life = repairable();
    const decision = assessStoreRepair({
      current: life,
      nowIso: NOW,
      probed: life,
      reading: ok(gauge({ alias: "plan-two" })),
    });
    expect(decision).toStrictEqual({ kind: "skip", reason: "not-credential-rejected" });
  });

  it("skips a successfully-read SPENT gauge, which is a measurement and not a credential problem", () => {
    // A repaired credential on a spent plan is still a spent plan. Capacity and credential eligibility are
    // separate questions, and refreshing a store whose week is gone would achieve nothing at all.
    const life = repairable();
    const decision = assessStoreRepair({
      current: life,
      nowIso: NOW,
      probed: life,
      reading: ok(spentGauge({ alias: "plan-two" })),
    });
    expect(decision).toStrictEqual({ kind: "skip", reason: "not-credential-rejected" });
  });

  it("skips a TRANSPORT failure, which is the owner's offline case and must attempt nothing", () => {
    const life = repairable();
    const decision = assessStoreRepair({
      current: life,
      nowIso: NOW,
      probed: life,
      reading: err(ClaudeRotationErrors.probeTransportFailed({ alias: "plan-two" })),
    });
    expect(decision).toStrictEqual({ kind: "skip", reason: "not-credential-rejected" });
  });

  it("skips a shape change", () => {
    const life = repairable();
    const decision = assessStoreRepair({
      current: life,
      nowIso: NOW,
      probed: life,
      reading: err(ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-5h-status" })),
    });
    expect(decision).toStrictEqual({ kind: "skip", reason: "not-credential-rejected" });
  });
});

describe("assessStoreRepair on a refused store that is not repairable", () => {
  it("skips an unreadable store WITHOUT claiming it is signed out", () => {
    const current = { alias: "plan-two", hasCredential: false, hasRefreshToken: false, unreadable: true };
    expect(assessStoreRepair({ current, nowIso: NOW, probed: repairable(), reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "unreadable-store",
    });
  });

  it("skips a store holding no access token at all", () => {
    const current = repairable({ hasCredential: false });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: repairable(), reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "no-credential",
    });
  });

  it("skips a store with no refresh grant to present", () => {
    const current = repairable({ hasRefreshToken: false });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "no-refresh-token",
    });
  });

  it("skips an ABSENT grant expiry, because unknown is never permission", () => {
    const current: StoreLife = {
      alias: "plan-two",
      expiresAtIso: EXPIRED,
      hasCredential: true,
      hasRefreshToken: true,
    };
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "unknown-refresh-expiry",
    });
  });

  it("skips an unparseable grant expiry", () => {
    const current = repairable({ refreshExpiresAtIso: "not an instant" });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "unknown-refresh-expiry",
    });
  });

  it("skips a grant that has expired, which only the owner's own browser repairs", () => {
    const current = repairable({ refreshExpiresAtIso: GRANT_DEAD });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "refresh-expired",
    });
  });

  it("skips a grant expiring EXACTLY now", () => {
    const current = repairable({ refreshExpiresAtIso: NOW });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "refresh-expired",
    });
  });

  it("skips an access expiry it cannot read, because 'already expired' is then unestablished", () => {
    const current: StoreLife = {
      alias: "plan-two",
      hasCredential: true,
      hasRefreshToken: true,
      refreshExpiresAtIso: GRANT_ALIVE,
    };
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "unknown-access-expiry",
    });
  });

  it("skips a refusal on a token that has NOT expired, which a refresh cannot repair", () => {
    // Claude Code refreshes only inside a token's last five minutes, so a command against a credential with
    // hours of life does nothing. And a refusal that is not an expiry is something else — a revoked grant, a
    // wrong account — none of which this mechanism addresses.
    const current = repairable({ expiresAtIso: ALIVE });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: current, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "access-not-expired",
    });
  });

  it("skips an unparseable clock rather than comparing against it", () => {
    const current = repairable();
    expect(
      assessStoreRepair({ current, nowIso: "half past something", probed: current, reading: refused }),
    ).toStrictEqual({ kind: "skip", reason: "invalid-now" });
  });

  it("skips when the refusal, the probed reading and the current reading do not all name one store", () => {
    const current = repairable({ alias: "plan-three" });
    expect(assessStoreRepair({ current, nowIso: NOW, probed: repairable(), reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "identity-mismatch",
    });
  });
});

describe("assessStoreRepair ignores an UNREADABLE store's expiry however it is spelled", () => {
  it("does not read a conflicting unreadable+expiry shape as a concurrent advance", () => {
    const probed = repairable();
    const current: StoreLife = {
      alias: "plan-two",
      expiresAtIso: ALIVE,
      hasCredential: true,
      hasRefreshToken: true,
      unreadable: true,
    };
    // `unreadable-store` wins, because the store was not read — not `reprobe`, which would claim something else
    // had repaired it on the strength of an expiry nothing actually read.
    expect(assessStoreRepair({ current, nowIso: NOW, probed, reading: refused })).toStrictEqual({
      kind: "skip",
      reason: "unreadable-store",
    });
  });
});

describe("assessStoreRepair on a store something else already refreshed", () => {
  it("re-probes without running any command when the expiry advanced into the future since the probe", () => {
    // Another session or the standing keep-alive can refresh a store in the moments between the probe being
    // refused and this reading. The cached token the refusal was about is then already gone, so one more probe
    // is the whole correct act — and that branch runs BEFORE any grant requirement, because it performs no
    // command whose safety the grant would govern.
    const probed = repairable();
    const current = repairable({ expiresAtIso: ALIVE });
    expect(assessStoreRepair({ current, nowIso: NOW, probed, reading: refused })).toStrictEqual({
      kind: "reprobe",
      reason: "advanced-since-probe",
    });
  });

  it("re-probes on a concurrent advance even when the grant metadata is unreadable", () => {
    const probed = repairable();
    const current: StoreLife = { alias: "plan-two", expiresAtIso: ALIVE, hasCredential: true, hasRefreshToken: false };
    expect(assessStoreRepair({ current, nowIso: NOW, probed, reading: refused })).toStrictEqual({
      kind: "reprobe",
      reason: "advanced-since-probe",
    });
  });

  it("does NOT treat an advance that is still in the past as concurrent recovery", () => {
    // A store refreshed from yesterday to this morning has advanced and is still dead, so the remaining
    // eligibility checks must run rather than the gate declaring it someone else's repair.
    const probed = repairable({ expiresAtIso: "2026-09-11T05:45:00.000Z" });
    const current = repairable({ expiresAtIso: EXPIRED });
    expect(assessStoreRepair({ current, nowIso: NOW, probed, reading: refused })).toStrictEqual({ kind: "attempt" });
  });
});

describe("assessStoreRefresh judges the attempt by the EXPIRY, never by the command", () => {
  const before = repairable();

  it("counts a strictly advanced expiry as a refresh and carries both instants", () => {
    const after = repairable({ expiresAtIso: ALIVE });
    expect(assessStoreRefresh({ after, before })).toStrictEqual({
      afterExpiresAtIso: ALIVE,
      alias: "plan-two",
      beforeExpiresAtIso: EXPIRED,
      status: "refreshed",
    });
  });

  it("counts an advance despite a command complaint, and keeps the complaint as a warning", () => {
    const after = repairable({ expiresAtIso: ALIVE });
    expect(assessStoreRefresh({ after, before, commandProblem: "the refresh command did not complete" })).toStrictEqual(
      {
        afterExpiresAtIso: ALIVE,
        alias: "plan-two",
        beforeExpiresAtIso: EXPIRED,
        commandProblem: "the refresh command did not complete",
        status: "refreshed",
      },
    );
  });

  it("fails an UNCHANGED expiry however cleanly the command exited", () => {
    // This is exactly how `claude doctor` stopped refreshing anything without a single error. MEASURED: run from an empty directory it exited 0 against an expired store and moved neither the keychain
    // modification date nor the expiry.
    const outcome = assessStoreRefresh({ after: repairable(), before });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toBe(
      "the refresh command exited cleanly and the expiry did not advance, so nothing was refreshed",
    );
  });

  it("fails a DECREASED expiry", () => {
    const outcome = assessStoreRefresh({ after: repairable({ expiresAtIso: "2026-09-12T05:00:00.000Z" }), before });
    expect(outcome.status).toBe("failed");
  });

  it("fails a failed command whose expiry did not move, and says both things", () => {
    const outcome = assessStoreRefresh({
      after: repairable(),
      before,
      commandProblem: "the refresh command did not complete",
    });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toBe("the refresh command did not complete, and the expiry did not advance");
  });

  it("fails an unreadable reading AFTER the attempt, and makes no claim about the sign-in state", () => {
    // The branch this witness came from is a TIMER, so it could honestly promise "the next tick reads it
    // again". An on-demand gate has no next tick, so the wording states what is unknown and stops.
    const after: StoreLife = { alias: "plan-two", hasCredential: false, hasRefreshToken: false, unreadable: true };
    const outcome = assessStoreRefresh({ after, before });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toBe(
      "the store could not be read back after the attempt, so nothing witnesses a refresh — its sign-in " +
        "state is unknown, and this is not evidence of one",
    );
  });

  it("fails an unreadable reading BEFORE the attempt rather than calling anything afterwards an improvement", () => {
    // A transient keychain read is `undefined`, exactly like a
    // signed-out store, so treating an absent before-reading as a baseline reported a refresh when the command
    // had timed out and the expiry had not moved at all.
    const unreadableBefore: StoreLife = {
      alias: "plan-two",
      hasCredential: false,
      hasRefreshToken: false,
      unreadable: true,
    };
    const outcome = assessStoreRefresh({ after: repairable({ expiresAtIso: ALIVE }), before: unreadableBefore });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toBe(
      "the store's own expiry could not be read before the attempt, so nothing witnesses a refresh — a " +
        "transient keychain read and a genuine repair are indistinguishable from the reading afterwards alone",
    );
  });

  it("fails a CLEARED credential without attributing a cause it did not observe", () => {
    // `claude doctor` has written back an emptied credential, and the provider has refused grants with
    // `invalid_grant`. Two metadata readings either side of a command cannot tell those apart, so
    // the wording reports the state and the remedy and claims no diagnosis.
    const after: StoreLife = { alias: "plan-two", hasCredential: false, hasRefreshToken: true };
    const outcome = assessStoreRefresh({ after, before });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toBe(
      "the store read back without an access credential after the attempt; the readings do not establish " +
        "why it was cleared — this store needs one browser sign-in",
    );
  });

  it("fails an UNREADABLE before-reading that nonetheless carries an expiry, which the type permits", () => {
    // `readStoreLife` never produces the combination, but `StoreLife`
    // permits it — and a witness bounded by its producer rather than by its types is not a witness. Before this
    // guard, a reading explicitly recording that the store could not be read reported `refreshed`.
    const conflicting: StoreLife = {
      alias: "plan-two",
      expiresAtIso: EXPIRED,
      hasCredential: true,
      hasRefreshToken: true,
      unreadable: true,
    };
    const outcome = assessStoreRefresh({ after: repairable({ expiresAtIso: ALIVE }), before: conflicting });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toContain("could not be read before the attempt");
  });

  it("fails when the two readings are of different stores, because then nothing witnesses anything", () => {
    const outcome = assessStoreRefresh({ after: repairable({ alias: "plan-three", expiresAtIso: ALIVE }), before });
    expect(outcome.status).toBe("failed");
    expect(failedProblem({ outcome })).toContain("are of different stores");
  });
});

describe("signInOnlyRepairSkipMeaning names the four skips only a sign-in repairs", () => {
  it("gives each sign-in-only reason its meaning", () => {
    const reasons: readonly StoreRepairSkipReason[] = [
      "access-not-expired",
      "no-credential",
      "no-refresh-token",
      "refresh-expired",
    ];
    expect(reasons.map((reason) => signInOnlyRepairSkipMeaning({ reason }))).toEqual([
      "a refusal on an unexpired token is a superseded or revoked login, which no refresh repairs",
      "this store is signed out, which no refresh repairs",
      "this store has no refresh grant, so no refresh can repair it",
      "this store's refresh grant has expired, which no refresh repairs",
    ]);
  });

  it("gives none for a reading that does not establish a sign-in is the repair", () => {
    const reasons: readonly StoreRepairSkipReason[] = [
      "not-credential-rejected",
      "unreadable-store",
      "unknown-access-expiry",
      "unknown-refresh-expiry",
      "invalid-now",
      "identity-mismatch",
      "already-attempted",
    ];
    expect(reasons.map((reason) => signInOnlyRepairSkipMeaning({ reason }))).toEqual(reasons.map(() => undefined));
  });
});
