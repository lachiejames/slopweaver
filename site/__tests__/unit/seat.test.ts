/*
 * Who is on a pull request, and the one case where the honest answer is what the read does not know. A row whose Slack history ends before the pull request's last activity drew a red
 * "PAUSED on … — nobody seated", which says more than a stale corpus can. The property: a `sync-slack` wait
 * turns an unseated row into a stale-history seat, and never outranks a fact a live reading holds.
 *
 * And a row the channel has — its drawn wait is `wait-on-channel`, or a Slack sync over a share whose clock is
 * unknown — never reads "PAUSED … nobody seated" beside its share, while a session on it still outranks the channel.
 */
import { describe, expect, it } from "vitest";

import { type Seat, seatLine, seatOf, seatTitle, sharedChannelOf } from "../../lib/seat";

const HEAD = "feat/thing";
const TEAMS = ["@acme/dx", "@acme/platform", "@acme/mx"] as const;
const THROUGH = "2026-09-25T11:40:22.000Z";
const SYNC = { next: "sync-slack", slackThroughIso: THROUGH };

/** A seat with nobody watching and no session on the branch, blocked on the three teams, under `wait`. */
const unseated = ({ wait }: { wait: { next: string; slackThroughIso: string | undefined } | undefined }): Seat =>
  seatOf({ blockedOn: TEAMS, depth: [], headRefName: HEAD, sessions: [], sharedIn: undefined, wait, watchers: [] });

describe("seatOf and a stale Slack history", () => {
  it("says the Slack history is stale since its watermark instead of nobody seated", () => {
    expect(unseated({ wait: SYNC })).toStrictEqual({ kind: "stale-history", on: TEAMS, throughIso: THROUGH });
  });

  it("stays stale-history, undated, over a wait that carries no watermark", () => {
    expect(unseated({ wait: { next: "sync-slack", slackThroughIso: undefined } })).toStrictEqual({
      kind: "stale-history",
      on: TEAMS,
      throughIso: undefined,
    });
  });

  it("keeps the pause on every other act, and with no wait at all", () => {
    expect(unseated({ wait: { next: "name-the-reviewer", slackThroughIso: undefined } }).kind).toBe("paused");
    expect(unseated({ wait: undefined }).kind).toBe("paused");
  });

  it("never lets a stale corpus unseat a session on the branch", () => {
    const seat = seatOf({
      blockedOn: TEAMS,
      depth: [],
      headRefName: HEAD,
      sessions: [{ branch: HEAD, key: "k1", slug: "s1", workspaceRef: "workspace:9" }],
      sharedIn: undefined,
      wait: SYNC,
      watchers: [],
    });
    expect(seat).toStrictEqual({ kind: "seated", slug: "s1", via: "branch", who: "workspace:9" });
  });

  it("never lets a stale corpus unseat a live watcher", () => {
    const seat = seatOf({
      blockedOn: TEAMS,
      depth: [{ sessionId: "sess-1", slug: "s1", title: undefined, workspaceRef: "workspace:3" }],
      headRefName: HEAD,
      sessions: [],
      sharedIn: undefined,
      wait: SYNC,
      watchers: [{ mode: "land", session: "sess-1", stale: false }],
    });
    expect(seat).toStrictEqual({ kind: "seated", slug: "s1", via: "watch", who: "workspace:3" });
  });

  it("keeps an unreadable fold unknown rather than claiming the history is the gap", () => {
    const seat = seatOf({
      blockedOn: TEAMS,
      depth: [],
      headRefName: HEAD,
      sessions: [],
      sharedIn: undefined,
      wait: SYNC,
      watchers: undefined,
    });
    expect(seat).toStrictEqual({ kind: "unknown", read: "watchers", why: "the watchers fold is not readable" });
  });

  it("says the history is stale even when the verb names nobody holding it", () => {
    const seat = seatOf({
      blockedOn: [],
      depth: [],
      headRefName: HEAD,
      sessions: [],
      sharedIn: undefined,
      wait: SYNC,
      watchers: [],
    });
    expect(seat).toStrictEqual({ kind: "stale-history", on: [], throughIso: THROUGH });
    expect(seatTitle({ seat })).toBe("Slack history stale since 2026-09-25 11:40Z, sync to know");
  });

  it("stays nobody when nothing holds it and no wait says the history is stale", () => {
    const seat = seatOf({
      blockedOn: [],
      depth: [],
      headRefName: HEAD,
      sessions: [],
      sharedIn: undefined,
      wait: undefined,
      watchers: [],
    });
    expect(seat).toStrictEqual({ kind: "nobody" });
  });
});

describe("seatLine and seatTitle on a stale-history seat", () => {
  it("prints since when, to the minute, and that a sync settles it", () => {
    expect(seatLine({ seat: unseated({ wait: SYNC }) })).toBe(
      "Slack history stale since 2026-09-25 11:40Z, sync to know",
    );
  });

  it("claims no staleness when the wait carried no watermark", () => {
    const seat = unseated({ wait: { next: "sync-slack", slackThroughIso: undefined } });
    expect(seatLine({ seat })).toBe("Slack history does not settle this, sync to know");
  });

  it("prints an offset-bearing watermark's instant in UTC, never its local clock fields", () => {
    const seat = unseated({ wait: { next: "sync-slack", slackThroughIso: "2026-09-25T00:30:00+10:00" } });
    expect(seatLine({ seat })).toBe("Slack history stale since 2026-09-24 14:30Z, sync to know");
  });

  it("names every team it is held for on hover", () => {
    expect(seatTitle({ seat: unseated({ wait: SYNC }) })).toBe(
      "Slack history stale since 2026-09-25 11:40Z, sync to know · held for @acme/dx, @acme/platform, @acme/mx",
    );
  });

  it("never says nobody seated", () => {
    expect(seatTitle({ seat: unseated({ wait: SYNC }) }).includes("nobody seated")).toBe(false);
    expect(seatTitle({ seat: unseated({ wait: undefined }) }).includes("nobody seated")).toBe(true);
  });
});

const HELD = ["@acme/platform", "@acme/security", "@acme/design"];

/** The seat with nobody watching and no session on the branch, the channel's wait drawn. */
function unshared({ sharedIn }: { sharedIn: string | undefined }): Seat {
  return seatOf({
    blockedOn: HELD,
    depth: [],
    headRefName: "b",
    sessions: [],
    sharedIn,
    wait: { next: "wait-on-channel", slackThroughIso: undefined },
    watchers: [],
  });
}

describe("seatOf — shared with a channel", () => {
  it("says the channel has it rather than PAUSED, nobody seated", () => {
    const seat = unshared({ sharedIn: "#dev-team" });
    expect(seat).toStrictEqual({ channel: "#dev-team", kind: "shared", on: HELD });
    expect(seatLine({ seat })).toBe("with #dev-team: no reviewer named yet");
    expect(seatTitle({ seat })).toBe(
      "shared with #dev-team, nobody named, and no session is on it · GitHub holds it on @acme/platform, @acme/security, @acme/design",
    );
  });

  it("stays PAUSED when no channel has it, so the red clock's 'name one' is not softened", () => {
    expect(seatLine({ seat: unshared({ sharedIn: undefined }) })).toBe(
      "PAUSED on @acme/platform, @acme/security +1 more: nobody seated",
    );
  });

  it("lets a session on the branch outrank the channel", () => {
    const seat = seatOf({
      blockedOn: HELD,
      depth: [],
      headRefName: "b",
      sessions: [{ branch: "b", key: "k1", slug: "s", workspaceRef: "ws-1" }],
      sharedIn: "#dev-team",
      wait: { next: "wait-on-channel", slackThroughIso: undefined },
      watchers: [],
    });
    expect(seat.kind).toBe("seated");
  });
});

describe("seatOf — an unknown share over a Slack sync", () => {
  it("names the channel that has it, not the stale history", () => {
    const seat = seatOf({
      blockedOn: HELD,
      depth: [],
      headRefName: "b",
      sessions: [],
      sharedIn: "#dev-team",
      wait: { next: "sync-slack", slackThroughIso: undefined },
      watchers: [],
    });
    expect(seat).toStrictEqual({ channel: "#dev-team", kind: "shared", on: HELD });
  });
});

describe("sharedChannelOf", () => {
  const share = (tone: string) => ({ channel: "#dev-team", tone });

  it("leaves a row the channel is waiting on with the channel", () => {
    expect(sharedChannelOf({ next: "wait-on-channel", share: share("green") })).toBe("#dev-team");
  });

  it("leaves a share whose clock is unknown with the channel while Slack is synced, never with nobody", () => {
    expect(sharedChannelOf({ next: "sync-slack", share: share("unknown") })).toBe("#dev-team");
  });

  it("leaves a red share, and a Slack sync over one, with nobody — its 'name one' stands", () => {
    expect([
      sharedChannelOf({ next: "ask", share: share("red") }),
      sharedChannelOf({ next: "sync-slack", share: share("red") }),
      sharedChannelOf({ next: "wait-on-channel", share: undefined }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
