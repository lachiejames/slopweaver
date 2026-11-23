import { describe, expect, it } from "vitest";

import type { AtlasKindStatus } from "../../../../atlas/kit/kindStatus.js";
import {
  derivedManifestClock,
  type KindClock,
  manifestClockDefects,
  PLACEHOLDER_CLOCK,
  stampAtlasManifest,
} from "../../../../atlas/kit/manifestClock.js";
import type { AtlasManifestLike } from "../../../../atlas/kit/store.js";

const EARLY = "2026-08-29T05:44:23.607Z";
const MID = "2026-08-29T08:52:37.556Z";
const LATE = "2026-09-03T17:17:14.637Z";

function clock({
  kind,
  updatedAt,
  lastSuccessAt = null,
  writtenSuccessfully = false,
}: {
  kind: string;
  updatedAt: string | null;
  lastSuccessAt?: string | null;
  writtenSuccessfully?: boolean;
}): KindClock {
  return { kind, lastSuccessAt, updatedAt, writtenSuccessfully };
}

describe("derivedManifestClock", () => {
  it("takes the NEWEST file clock, which is the direction the 1Password generation was wrong in", () => {
    // The measured shape: six kind files at one instant and an events file five days newer,
    // under a manifest that still carried an earlier clock.
    const derived = derivedManifestClock({
      clocks: [
        clock({ kind: "user", updatedAt: MID }),
        clock({ kind: "vault", updatedAt: MID }),
        clock({ kind: "event", updatedAt: LATE }),
      ],
      fallback: EARLY,
    });
    expect(derived).toBe(LATE);
  });

  it("cannot run AHEAD of the files, which is the other direction the owner named", () => {
    const derived = derivedManifestClock({
      clocks: [clock({ kind: "user", updatedAt: EARLY }), clock({ kind: "vault", updatedAt: MID })],
      fallback: LATE,
    });
    expect(derived).toBe(MID);
  });

  it("ignores a kind that holds no file at all", () => {
    const derived = derivedManifestClock({
      clocks: [clock({ kind: "user", updatedAt: null }), clock({ kind: "vault", updatedAt: MID })],
      fallback: EARLY,
    });
    expect(derived).toBe(MID);
  });

  it("takes the fallback only when the generation vouches for no file whatsoever", () => {
    const derived = derivedManifestClock({
      clocks: [clock({ kind: "user", updatedAt: null }), clock({ kind: "vault", updatedAt: null })],
      fallback: EARLY,
    });
    expect(derived).toBe(EARLY);
  });

  it("takes the fallback over an empty kind list", () => {
    expect(derivedManifestClock({ clocks: [], fallback: MID })).toBe(MID);
  });
});

describe("manifestClockDefects", () => {
  it("refuses a kind whose file and its own just-recorded success disagree", () => {
    const defects = manifestClockDefects({
      clocks: [clock({ kind: "user", lastSuccessAt: EARLY, updatedAt: MID, writtenSuccessfully: true })],
    });
    expect(defects).toEqual([
      `user carries two clocks: its file says ${MID} while the status published beside it says it last` +
        ` succeeded at ${EARLY}`,
    ]);
  });

  it("admits a FAILED kind whose file moved while its success time did not", () => {
    // Measured on cloudflare/sync/lifecycle.test.ts: a failed read still rewrites the file, because its coverage cell
    // now records the failure. Both clocks are true and they answer different questions.
    const defects = manifestClockDefects({
      clocks: [clock({ kind: "zone", lastSuccessAt: EARLY, updatedAt: MID, writtenSuccessfully: false })],
    });
    expect(defects).toEqual([]);
  });

  it("admits an untouched kind whose stored file is newer than its recorded success", () => {
    const defects = manifestClockDefects({
      clocks: [clock({ kind: "event", lastSuccessAt: EARLY, updatedAt: LATE, writtenSuccessfully: false })],
    });
    expect(defects).toEqual([]);
  });

  it("admits a kind written successfully whose two clocks are the same instant", () => {
    const defects = manifestClockDefects({
      clocks: [clock({ kind: "user", lastSuccessAt: MID, updatedAt: MID, writtenSuccessfully: true })],
    });
    expect(defects).toEqual([]);
  });

  it("says nothing about a generation with no clocks to compare", () => {
    expect(manifestClockDefects({ clocks: [] })).toEqual([]);
  });
});

describe("the invariant that replaced JumpCloud's deleted clock check", () => {
  it("makes a manifest clock behind a success it grades unrepresentable", () => {
    // The deleted guard refused `manifest.updatedAt < status.lastSuccessAt`. It can no longer fire: a
    // successfully written kind's file carries the same instant as its success (asserted above), and the
    // derived clock is the MAXIMUM over those files — so it is >= every success the manifest grades.
    const clocks = [
      clock({ kind: "user", lastSuccessAt: MID, updatedAt: MID, writtenSuccessfully: true }),
      clock({ kind: "event", lastSuccessAt: LATE, updatedAt: LATE, writtenSuccessfully: true }),
      clock({ kind: "vault", lastSuccessAt: EARLY, updatedAt: EARLY, writtenSuccessfully: false }),
    ];
    const derived = derivedManifestClock({ clocks, fallback: EARLY });
    expect(manifestClockDefects({ clocks })).toEqual([]);
    expect(derived).toBe(LATE);
    const behind = clocks.filter((one) => one.lastSuccessAt !== null && one.lastSuccessAt > derived);
    expect(behind).toEqual([]);
  });
});

describe("stampAtlasManifest", () => {
  const KINDS = ["user", "vault"] as const;
  type TestKind = (typeof KINDS)[number];
  type TestManifest = AtlasManifestLike<TestKind> & { readonly platform: string };
  const ran: AtlasKindStatus = {
    digest: null,
    entityCount: 3,
    lastAttempt: { at: LATE, outcome: "ok", reasons: ["one skipped record"] },
    lastSuccessAt: LATE,
  };

  it("takes this run's status, else the stored one, else an empty one, and never a clock of its own", () => {
    const stored: AtlasKindStatus = { digest: "abc", entityCount: 7, lastAttempt: null, lastSuccessAt: EARLY };
    const manifest = stampAtlasManifest<TestKind, TestManifest>({
      base: { platform: "test", schemaVersion: 1 },
      kinds: KINDS,
      prior: { kinds: { user: stored, vault: stored }, platform: "test", schemaVersion: 1, updatedAt: MID },
      statuses: { user: ran },
    });
    expect(manifest).toEqual({
      kinds: { user: ran, vault: stored },
      platform: "test",
      schemaVersion: 1,
      updatedAt: MID,
    });
  });

  it("stamps an unreached kind empty and the clock as the placeholder when there is no prior generation", () => {
    const manifest = stampAtlasManifest<TestKind, TestManifest>({
      base: { platform: "test", schemaVersion: 1 },
      kinds: KINDS,
      prior: null,
      statuses: {},
    });
    expect(manifest.kinds.user).toEqual({ digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null });
    expect(manifest.updatedAt).toBe(PLACEHOLDER_CLOCK);
  });

  it("copies an attempt's reasons into a fresh array rather than sharing the caller's", () => {
    const manifest = stampAtlasManifest<TestKind, TestManifest>({
      base: { platform: "test", schemaVersion: 1 },
      kinds: KINDS,
      prior: null,
      statuses: { user: ran },
    });
    expect(manifest.kinds.user.lastAttempt).toEqual(ran.lastAttempt);
    expect(manifest.kinds.user.lastAttempt!.reasons).not.toBe(ran.lastAttempt!.reasons);
  });
});
