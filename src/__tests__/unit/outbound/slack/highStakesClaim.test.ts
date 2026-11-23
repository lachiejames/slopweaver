/**
 * The high-stakes channel claim, round-tripped through a throwaway home: write-then-list is the whole point, so
 * it is exercised against a real filesystem rather than restated.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HIGH_STAKES_CLAIM_WINDOW_MS, HIGH_STAKES_WINDOW_MS } from "../../../../outbound/slack/highStakesChannel.js";
import {
  peekHighStakesClaim,
  releaseHighStakesClaim,
  takeHighStakesClaim,
} from "../../../../outbound/slack/highStakesClaim.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "high-stakes-claim-"));
  fixtureDirs.push(dir);
  return dir;
}

function claimsDir({ home }: { home: string }): string {
  return join(home, "ledgers", "high-stakes-claims", "C0SYN000003");
}

const T0 = "2026-09-28T20:00:00.000Z";
const LATER = new Date(Date.parse(T0) + HIGH_STAKES_CLAIM_WINDOW_MS - 1).toISOString();
const AGED = new Date(Date.parse(T0) + HIGH_STAKES_CLAIM_WINDOW_MS).toISOString();
const DAY_LATER = new Date(Date.parse(T0) + HIGH_STAKES_WINDOW_MS).toISOString();
const WRITER = 4242;
const STALE_NAME = `${String(Date.parse(T0) - HIGH_STAKES_CLAIM_WINDOW_MS)}-${String(WRITER)}-00000000-0000-4000-8000-000000000000`;
/** Every claim's writer has exited, so only the claim window keeps one standing. */
const EXITED = (): boolean => false;
/** Every claim's writer is still running, as a send stalled in a rate-limited read would be. */
const RUNNING = (): boolean => true;

describe("takeHighStakesClaim", () => {
  it("lets one send hold a channel, and names when the other one took it", () => {
    const home = freshHome();
    const first = takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    expect(first.kind).toBe("held");
    expect(takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER, pid: WRITER })).toEqual({
      claimedIso: T0,
      kind: "taken",
    });
    expect(takeHighStakesClaim({ alive: EXITED, channel: "C0OTHER", home, nowIso: LATER, pid: WRITER }).kind).toBe(
      "held",
    );
  });

  it("keeps a claim standing past the claim window while its writer runs, and neither prunes nor passes it", () => {
    const home = freshHome();
    const stalled = takeHighStakesClaim({ alive: RUNNING, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    expect(stalled.kind).toBe("held");
    expect(takeHighStakesClaim({ alive: RUNNING, channel: "C0SYN000003", home, nowIso: AGED, pid: 1 })).toEqual({
      claimedIso: T0,
      kind: "taken",
    });
    expect(readdirSync(claimsDir({ home })).length).toBe(1);
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: AGED })).toEqual({
      kind: "free",
    });
  });

  it("lets a running writer's claim fall once the whole day window has passed", () => {
    const home = freshHome();
    takeHighStakesClaim({ alive: RUNNING, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    expect(peekHighStakesClaim({ alive: RUNNING, channel: "C0SYN000003", home, nowIso: DAY_LATER })).toEqual({
      kind: "free",
    });
  });

  it("removes its own file when it loses, so only the holder's claim stands", () => {
    const home = freshHome();
    takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER, pid: WRITER });
    expect(readdirSync(claimsDir({ home })).map((name) => name.split("-")[0])).toEqual([String(Date.parse(T0))]);
  });

  it("never removes a claim that still holds, and prunes only the aged-out one lying beside it", () => {
    const home = freshHome();
    mkdirSync(claimsDir({ home }), { recursive: true });
    writeFileSync(join(claimsDir({ home }), STALE_NAME), "");
    const first = takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    expect(first.kind).toBe("held");
    expect(takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER, pid: WRITER })).toEqual({
      claimedIso: T0,
      kind: "taken",
    });
    expect(readdirSync(claimsDir({ home })).includes(STALE_NAME)).toBe(false);
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER })).toEqual({
      claimedIso: T0,
      kind: "taken",
    });
  });

  it("holds against a claim dated after its own instant, which another send's clock read first", () => {
    const home = freshHome();
    takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER, pid: WRITER });
    expect(takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER })).toEqual({
      claimedIso: LATER,
      kind: "taken",
    });
  });

  it("takes the channel again once the earlier claim has aged out", () => {
    const home = freshHome();
    takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    expect(takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: AGED, pid: WRITER }).kind).toBe(
      "held",
    );
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: AGED })).toEqual({
      claimedIso: AGED,
      kind: "taken",
    });
  });

  it("passes over a file whose name is not a claim", () => {
    const home = freshHome();
    mkdirSync(claimsDir({ home }), { recursive: true });
    writeFileSync(join(claimsDir({ home }), ".DS_Store"), "");
    expect(takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER }).kind).toBe(
      "held",
    );
  });

  it("is unwritable, naming why, when the home cannot hold the claim", () => {
    const home = freshHome();
    const notADirectory = join(home, "file");
    writeFileSync(notADirectory, "");
    const claim = takeHighStakesClaim({
      alive: EXITED,
      channel: "C0SYN000003",
      home: notADirectory,
      nowIso: T0,
      pid: WRITER,
    });
    expect(claim.kind).toBe("unwritable");
    expect(JSON.stringify(claim)).toContain("ENOTDIR");
  });

  it("is unwritable when the instant it is judged at is not one, rather than writing a claim nothing can date", () => {
    expect(
      takeHighStakesClaim({
        alive: EXITED,
        channel: "C0SYN000003",
        home: freshHome(),
        nowIso: "not-a-time",
        pid: WRITER,
      }),
    ).toEqual({
      kind: "unwritable",
      reason: "not-a-time is not an instant, so no claim could be dated",
    });
  });
});

describe("peekHighStakesClaim and releaseHighStakesClaim", () => {
  it("looks without taking, and releasing a claim by its id leaves the channel free", () => {
    const home = freshHome();
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0 })).toEqual({ kind: "free" });
    const held = takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    expect(held.kind).toBe("held");
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER })).toEqual({
      claimedIso: T0,
      kind: "taken",
    });
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: AGED })).toEqual({
      kind: "free",
    });
    const { claimId } = held as { claimId: string };
    releaseHighStakesClaim({ channel: "C0SYN000003", claimId, home });
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER })).toEqual({
      kind: "free",
    });
  });

  it("releases only the named claim, never another send's", () => {
    const home = freshHome();
    takeHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: T0, pid: WRITER });
    releaseHighStakesClaim({ channel: "C0SYN000003", claimId: STALE_NAME, home });
    expect(peekHighStakesClaim({ alive: EXITED, channel: "C0SYN000003", home, nowIso: LATER })).toEqual({
      claimedIso: T0,
      kind: "taken",
    });
  });
});
