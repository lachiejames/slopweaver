/**
 * The wake a parked seat carries: what `handover park`'s two flags accept, what a journal line decodes to, and
 * when `handover wake` judges one due. Pure — the clock and the provider read are arguments, and the read here
 * is a plain fake that answers what each case names.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";

import {
  type ChecksWakeObservation,
  checksWakeFingerprint,
  decodeParkWake,
  judgeParkWake,
  ParkWakeErrors,
  parkWakePhrase,
  parseParkWake,
  type ReadChecksWake,
  sameWakeObservation,
  type WakeObservation,
} from "../../../handover/parkWake.js";
import { type GithubChecksSnapshot, parseChecksSnapshot } from "../../../live/github/checks.js";
import type { GithubCheck } from "../../../live/github/checksDedupe.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";

const NOW = new Date("2026-10-15T03:13:00.000Z");

/** A check in one state. */
function check({ name, state }: { name: string; state: GithubCheck["state"] }): GithubCheck {
  return { kind: "check-run", name, state, url: undefined };
}

/** An open pull request's snapshot over the given checks. */
function open({
  checks,
  truncated = false,
}: {
  checks: readonly GithubCheck[];
  truncated?: boolean;
}): ChecksWakeObservation {
  const snapshot: GithubChecksSnapshot = {
    baseRef: "main",
    checks,
    headSha: "abc123",
    mergeable: "MERGEABLE",
    residue: [],
    rollupState: "PENDING",
    supersededChecks: [],
    truncated,
  };
  return { checks: snapshot, prState: "OPEN" };
}

/** A read that answers one observation and records what it was asked. */
function readAnswering({
  observation,
  asked,
}: {
  observation: ChecksWakeObservation;
  asked: string[];
}): ReadChecksWake {
  return async ({ repo, number }) => {
    asked.push(`${repo}#${String(number)}`);
    return ok(observation);
  };
}

const CHECKS_WAKE = { kind: "checks", number: 9877, repo: "acme/acme-admin" } as const;

/** The snapshot an open read carries; a closed one carries none, which no caller here passes. */
function unwrapOpen({ read }: { read: ChecksWakeObservation }): GithubChecksSnapshot {
  if (read.prState !== "OPEN") {
    throw new Error(`expected an open read, got ${read.prState}`);
  }
  return read.checks;
}

/** A snapshot of `open()`'s shape with the checks and head named. */
function snapshotOf({
  checks,
  headSha = "abc123",
}: {
  checks: readonly GithubCheck[];
  headSha?: string;
}): GithubChecksSnapshot {
  return { ...unwrapOpen({ read: open({ checks }) }), headSha };
}

describe("checksWakeFingerprint and sameWakeObservation", () => {
  const unit: GithubCheck = {
    conclusion: "SUCCESS",
    kind: "check-run",
    name: "unit",
    runId: "1",
    state: "passed",
    url: "u1",
  };
  const lint: GithubCheck = {
    conclusion: "SUCCESS",
    kind: "check-run",
    name: "lint",
    runId: "2",
    state: "passed",
    url: "u2",
  };
  const base = checksWakeFingerprint({ checks: snapshotOf({ checks: [unit, lint] }) });

  it("ignores the order the read returned its checks in", () => {
    expect(checksWakeFingerprint({ checks: snapshotOf({ checks: [lint, unit] }) })).toBe(base);
  });

  // a re-run the parser discarded as a duplicate is still a new run.
  it("changes when a re-run lands only among the superseded checks", () => {
    const rerun = {
      ...snapshotOf({ checks: [unit, lint] }),
      supersededChecks: [
        {
          completedAt: undefined,
          conclusion: "SUCCESS",
          kind: "check-run",
          name: "unit",
          replacedBy: undefined,
          runId: "202",
          state: "passed",
        },
      ],
    } satisfies GithubChecksSnapshot;
    expect(checksWakeFingerprint({ checks: rerun })).not.toBe(base);
  });

  it("changes with the head, a re-run, a conclusion or a details URL", () => {
    const variants = [
      snapshotOf({ checks: [unit, lint], headSha: "def456" }),
      snapshotOf({ checks: [{ ...unit, runId: "3" }, lint] }),
      snapshotOf({ checks: [{ ...unit, conclusion: "FAILURE", state: "failed" }, lint] }),
      snapshotOf({ checks: [{ ...unit, url: "u9" }, lint] }),
    ];
    expect(variants.map((checks) => checksWakeFingerprint({ checks }) === base)).toEqual([false, false, false, false]);
  });

  // a legacy Status, and a Check Run another app posted, carry no run id, so a re-run of the same name,
  // state and URL differs only in the instant GitHub dated it.
  it("changes when a Status or a non-Actions Check Run re-runs with the same name, state and URL", () => {
    const legacy: GithubCheck = {
      datedAt: "2026-10-30T05:00:00Z",
      kind: "status",
      name: "ci/vendor",
      state: "failed",
      url: "https://ci.example/1",
    };
    const vendor: GithubCheck = {
      conclusion: "FAILURE",
      datedAt: "2026-10-30T05:00:00Z",
      kind: "check-run",
      name: "vendor",
      state: "failed",
      url: undefined,
    };
    const rerunAt = "2026-10-30T05:20:00Z";
    const pairs = [legacy, vendor].map(
      (first) =>
        checksWakeFingerprint({ checks: snapshotOf({ checks: [first] }) }) ===
        checksWakeFingerprint({ checks: snapshotOf({ checks: [{ ...first, datedAt: rerunAt }] }) }),
    );
    expect(pairs).toEqual([false, false]);
  });

  it("matches the same instant or pull request state, and never a different one", () => {
    const at = { atIso: "2026-10-15T03:00:00Z", kind: "at" } as const;
    const merged = { ...CHECKS_WAKE, prState: "MERGED" } as const;
    expect([
      sameWakeObservation({ left: at, right: { ...at } }),
      sameWakeObservation({ left: at, right: { ...at, atIso: "2026-10-15T03:05:00Z" } }),
      sameWakeObservation({ left: merged, right: { ...merged } }),
      sameWakeObservation({ left: merged, right: { ...merged, prState: "CLOSED" } }),
      sameWakeObservation({ left: merged, right: { ...merged, number: 1 } }),
      sameWakeObservation({ left: merged, right: at }),
    ]).toEqual([true, false, true, false, false, false]);
  });

  // one instant spelled two ways is one condition.
  it("keys an instant by its value, not its spelling", () => {
    const at = { atIso: "2026-10-15T03:00:00Z", kind: "at" } as const;
    expect([
      sameWakeObservation({ left: at, right: { ...at, atIso: "2026-10-15T03:00:00.000Z" } }),
      sameWakeObservation({ left: at, right: { ...at, atIso: "2026-10-15T03:00:00.001Z" } }),
    ]).toEqual([true, false]);
  });
});

describe("parseParkWake", () => {
  it("is no wake when neither flag was given", () => {
    expect(unwrap(parseParkWake({ wakeAt: undefined, wakeOnChecks: undefined }))).toBe(undefined);
  });

  it("keeps a UTC instant verbatim", () => {
    expect(unwrap(parseParkWake({ wakeAt: "2026-10-15T03:13:00Z", wakeOnChecks: undefined }))).toEqual({
      atIso: "2026-10-15T03:13:00Z",
      kind: "at",
    });
  });

  it("splits owner/name#N into the repository and the number", () => {
    expect(unwrap(parseParkWake({ wakeAt: undefined, wakeOnChecks: "acme/acme-admin#9877" }))).toEqual(CHECKS_WAKE);
  });

  it("refuses both flags at once", () => {
    const parsed = parseParkWake({ wakeAt: "2026-10-15T03:13:00Z", wakeOnChecks: "o/r#1" });
    expect(unwrapErr(parsed)).toEqual(ParkWakeErrors.exclusive());
    expect(unwrapErr(parsed).message).toBe(
      "--wake-at and --wake-on-checks are mutually exclusive: a park waits on one thing",
    );
  });

  it("refuses an offset, a bare date and an impossible calendar day, never moving one", () => {
    const values = ["2026-10-15T03:13:00+10:00", "2026-10-15", "2026-02-30T00:00:00Z", "soon"];
    const refusals = values.map((wakeAt) => unwrapErr(parseParkWake({ wakeAt, wakeOnChecks: undefined })));
    expect(refusals).toEqual(values.map((value) => ParkWakeErrors.wakeAtInvalid({ value })));
    expect(refusals[3]!.message).toBe('--wake-at "soon" is not one UTC instant (YYYY-MM-DDTHH:MM:SSZ)');
  });

  it("refuses a target that is not exactly owner/name#N with a positive number", () => {
    const values = [
      "acme-admin#1",
      "o/r#0",
      "o/r#1.5",
      "o/r/x#1",
      "o/r#1#2",
      "o/r #1",
      "https://github.com/o/r/pull/1",
    ];
    const refusals = values.map((wakeOnChecks) => unwrapErr(parseParkWake({ wakeAt: undefined, wakeOnChecks })));
    expect(refusals).toEqual(values.map((value) => ParkWakeErrors.wakeTargetInvalid({ value })));
    expect(refusals[1]!.message).toBe('--wake-on-checks "o/r#0" is not owner/name#N');
  });
});

describe("decodeParkWake", () => {
  it("decodes both well-formed shapes", () => {
    expect([
      decodeParkWake({ raw: { atIso: "2026-10-15T03:13:00Z", kind: "at" } }),
      decodeParkWake({ raw: { kind: "checks", number: 9877, repo: "acme/acme-admin" } }),
    ]).toEqual([{ atIso: "2026-10-15T03:13:00Z", kind: "at" }, CHECKS_WAKE]);
  });

  it("drops anything not exactly one wake rather than coercing it", () => {
    const raws: unknown[] = [
      undefined,
      "2026-10-15T03:13:00Z",
      [],
      { atIso: "2026-10-15T03:13:00+10:00", kind: "at" },
      { atIso: "2026-10-15T03:13:00Z", kind: "at", extra: 1 },
      { kind: "checks", number: "9877", repo: "o/r" },
      { kind: "checks", number: 0, repo: "o/r" },
      { kind: "checks", number: 1.5, repo: "o/r" },
      { kind: "checks", number: 1, repo: "o" },
      { atIso: "2026-10-15T03:13:00Z", kind: "checks", number: 1, repo: "o/r" },
      { kind: "later" },
    ];
    expect(raws.map((raw) => decodeParkWake({ raw }))).toEqual(raws.map(() => undefined));
  });
});

describe("judgeParkWake", () => {
  const never: ReadChecksWake = async () => err(GithubLiveErrors.readFailed({ message: "not asked" }));

  it("is not due before its instant, due at it and after it", async () => {
    const judged = await Promise.all(
      ["2026-10-15T03:13:01Z", "2026-10-15T03:13:00Z", "2026-10-15T03:12:59Z"].map((atIso) =>
        judgeParkWake({ now: NOW, readChecks: never, wake: { atIso, kind: "at" } }),
      ),
    );
    expect(judged.map((judgement) => judgement.kind)).toEqual(["not-due", "due", "due"]);
    expect(judged[0]!.reason).toBe("it wakes at 2026-10-15T03:13:01Z");
  });

  it("wakes on terminal checks, red included, and reads the named pull request once", async () => {
    const asked: string[] = [];
    const greenRead = open({ checks: [check({ name: "a", state: "passed" })] });
    const redRead = open({
      checks: [check({ name: "a", state: "passed" }), check({ name: "b", state: "failed" })],
    });
    const green = await judgeParkWake({
      now: NOW,
      readChecks: readAnswering({ asked, observation: greenRead }),
      wake: CHECKS_WAKE,
    });
    const red = await judgeParkWake({
      now: NOW,
      readChecks: readAnswering({ asked, observation: redRead }),
      wake: CHECKS_WAKE,
    });
    /** What a due open read records: its head and the digest of the very snapshot read. */
    const observedOf = ({ read }: { read: ChecksWakeObservation }): WakeObservation => ({
      ...CHECKS_WAKE,
      fingerprint: checksWakeFingerprint({ checks: unwrapOpen({ read }) }),
      headSha: "abc123",
      prState: "OPEN",
    });
    expect([green, red]).toEqual([
      {
        kind: "due",
        observed: observedOf({ read: greenRead }),
        reason: "acme/acme-admin#9877's checks finished: 1 passed, 0 failed",
      },
      {
        kind: "due",
        observed: observedOf({ read: redRead }),
        reason: "acme/acme-admin#9877's checks finished: 1 passed, 1 failed",
      },
    ]);
    expect(observedOf({ read: greenRead })).not.toEqual(observedOf({ read: redRead }));
    expect(asked).toEqual(["acme/acme-admin#9877", "acme/acme-admin#9877"]);
  });

  it("is not due while a check runs or queues", async () => {
    const judged = await judgeParkWake({
      now: NOW,
      readChecks: readAnswering({
        asked: [],
        observation: open({
          checks: [check({ name: "a", state: "running" }), check({ name: "b", state: "queued" })],
        }),
      }),
      wake: CHECKS_WAKE,
    });
    expect(judged).toEqual({
      kind: "not-due",
      reason: "acme/acme-admin#9877 has 1 running and 1 queued check(s)",
    });
  });

  it("wakes on a merged or closed pull request whatever its checks, a merge carrying its commit", async () => {
    const judged = await Promise.all(
      [{ mergeCommitOid: "m1", prState: "MERGED" } as const, { prState: "CLOSED" } as const].map((observation) =>
        judgeParkWake({ now: NOW, readChecks: readAnswering({ asked: [], observation }), wake: CHECKS_WAKE }),
      ),
    );
    expect(judged).toEqual([
      {
        kind: "due",
        mergeCommitOid: "m1",
        observed: { ...CHECKS_WAKE, prState: "MERGED" },
        reason: "acme/acme-admin#9877 is MERGED",
      },
      { kind: "due", observed: { ...CHECKS_WAKE, prState: "CLOSED" }, reason: "acme/acme-admin#9877 is CLOSED" },
    ]);
  });

  it("is UNKNOWN on a truncated read, even one whose page all reads terminal", async () => {
    const judged = await judgeParkWake({
      now: NOW,
      readChecks: readAnswering({
        asked: [],
        observation: open({ checks: [check({ name: "a", state: "passed" })], truncated: true }),
      }),
      wake: CHECKS_WAKE,
    });
    expect(judged.kind).toBe("unknown");
  });

  it("is UNKNOWN when the only running context does not decode, though every decoded one passed", async () => {
    const parsed = unwrap(
      parseChecksSnapshot({
        data: {
          repository: {
            pullRequest: {
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: "abc123",
                      statusCheckRollup: {
                        contexts: {
                          nodes: [
                            { __typename: "CheckRun", conclusion: "SUCCESS", name: "lint", status: "COMPLETED" },
                            null,
                          ],
                          pageInfo: { hasNextPage: false },
                        },
                        state: "PENDING",
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        identity: "acme/acme-admin#9877",
      }),
    );
    const judged = await judgeParkWake({
      now: NOW,
      readChecks: readAnswering({ asked: [], observation: { checks: parsed, prState: "OPEN" } }),
      wake: CHECKS_WAKE,
    });
    expect(judged).toEqual({
      kind: "unknown",
      reason:
        "acme/acme-admin#9877's checks did not fully read (1 check context(s) did not decode, so the read is short), so none is proven done",
    });
  });

  it("is UNKNOWN when the read fails, naming why", async () => {
    const judged = await judgeParkWake({
      now: NOW,
      readChecks: async () => err(GithubLiveErrors.readFailed({ message: "rate limited" })),
      wake: CHECKS_WAKE,
    });
    expect(judged).toEqual({ kind: "unknown", reason: "acme/acme-admin#9877 could not be read: rate limited" });
  });
});

describe("parkWakePhrase", () => {
  it("names the instant or the pull request a row waits on", () => {
    expect([
      parkWakePhrase({ wake: { atIso: "2026-10-15T03:13:00Z", kind: "at" } }),
      parkWakePhrase({ wake: CHECKS_WAKE }),
    ]).toEqual(["until 2026-10-15T03:13:00Z", "on CI for acme/acme-admin#9877"]);
  });
});
