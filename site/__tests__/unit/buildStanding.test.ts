import { describe, expect, it } from "vitest";

import { ageAt, buildStanding, shortSha } from "../../lib/buildStanding";
import { type ConsoleBuildReport, type ConsoleCommit, readConsoleBuildReport } from "../../lib/buildStandingReport";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const NOW_MS = Date.parse("2026-09-28T07:00:00Z");

/** One mainline commit, newest first by position. */
const commit = ({ sha, title, number }: { sha: string; title: string; number?: number }): ConsoleCommit => ({
  changesConsole: false,
  changesShell: false,
  committedIso: "2026-09-28T06:00:00Z",
  pullRequest:
    number === undefined ? undefined : { number, url: `https://github.com/lachiejames/slopweaver/pull/${number}` },
  sha,
  title,
});

/** The mainline A (newest) ← B ← C. */
const MAINLINE: readonly ConsoleCommit[] = [
  commit({ number: 3, sha: SHA_A, title: "newest" }),
  commit({ number: 2, sha: SHA_B, title: "middle" }),
  commit({ sha: SHA_C, title: "oldest" }),
];

/** A report serving and checked out at the newest commit, nothing running, the upstream current. */
const report = (over: Partial<ConsoleBuildReport> = {}): ConsoleBuildReport => ({
  head: { sha: SHA_A },
  installedApp: undefined,
  mainline: { commits: MAINLINE, limit: 50, truncated: false },
  observedAtIso: "2026-09-28T06:59:00Z",
  problems: [],
  rebuild: { logPath: "/home/docs-site/x.refresh.log", running: false, waiting: undefined },
  root: "/work/slopweaver",
  served: { kind: "production", live: true, sha: SHA_A, startedIso: "2026-09-28T06:54:34Z" },
  upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T06:58:00Z", ref: "origin/main", sha: SHA_A },
  ...over,
});

/** The build baked into the page. */
const loaded = ({ sha }: { sha: string }): { sha: string; committedIso: string } => ({
  committedIso: "2026-09-28T05:00:00Z",
  sha,
});

const standingOf = ({
  sha,
  over = {},
  callLive = false,
  callWaiting,
}: {
  sha: string;
  over?: Partial<ConsoleBuildReport>;
  callLive?: boolean;
  callWaiting?: { sha: string; pid: number; sinceIso: string };
}): ReturnType<typeof buildStanding> =>
  buildStanding({ callLive, callWaiting, loaded: loaded({ sha }), nowMs: NOW_MS, report: report(over) });

describe("ageAt", () => {
  it("says just now inside a minute", () => {
    expect(ageAt({ iso: "2026-09-28T06:59:30Z", nowMs: NOW_MS })).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ageAt({ iso: "2026-09-28T06:48:00Z", nowMs: NOW_MS })).toBe("12m ago");
    expect(ageAt({ iso: "2026-09-28T03:30:00Z", nowMs: NOW_MS })).toBe("3.5h ago");
    expect(ageAt({ iso: "2026-09-26T07:00:00Z", nowMs: NOW_MS })).toBe("2.0d ago");
  });

  it("names an instant that does not parse rather than inventing an age", () => {
    expect(ageAt({ iso: "yesterday", nowMs: NOW_MS })).toBe("at an unreadable instant");
  });
});

describe("shortSha", () => {
  it("keeps nine digits", () => {
    expect(shortSha({ sha: SHA_A })).toBe("aaaaaaaaa");
  });
});

describe("buildStanding", () => {
  it("says latest when the page, the server, the checkout and the upstream agree", () => {
    const standing = standingOf({ sha: SHA_A });
    expect(standing.kind).toBe("current");
    expect(standing.tone).toBe("ok");
    expect(standing.headline).toBe("Latest build");
    expect(standing.glance).toBe("latest");
    expect(standing.build).toBe("rebuilt 5m ago");
    expect(standing.step).toBe(undefined);
    expect(standing.checked).toBe("origin/main checked 2m ago");
  });

  it("names the commit's age, never a hex id, when the console serves a different build than the page", () => {
    const standing = standingOf({ sha: SHA_C });
    expect(standing.build).toBe("commit 2.0h ago");
  });

  it("asks for a hard refresh when the server has a newer build than the page, naming what it is missing", () => {
    const standing = standingOf({ sha: SHA_C });
    expect(standing.kind).toBe("reload");
    expect(standing.headline).toBe("2 commits behind: hard refresh");
    expect(standing.glance).toBe("2 behind, refresh");
    expect(standing.step).toBe("hard refresh (⌘⇧R) loads aaaaaaaaa");
    expect(standing.missing.map((missing) => missing.title)).toEqual(["newest", "middle"]);
    expect(standing.missing[0].pullRequest!.url).toBe("https://github.com/lachiejames/slopweaver/pull/3");
  });

  it("says to refresh after the call rather than now while a call is live", () => {
    const standing = standingOf({ callLive: true, sha: SHA_B });
    expect(standing.kind).toBe("reload");
    expect(standing.step).toBe("hard refresh after this call; reloading now would end it; it loads aaaaaaaaa");
  });

  it("says a build is waiting on the call when the call's lease answer carries one", () => {
    const standing = standingOf({
      callLive: true,
      callWaiting: { pid: 7, sha: SHA_A, sinceIso: "2026-09-28T06:58:00Z" },
      over: { served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" } },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("waiting");
    expect(standing.headline).toBe("1 commit behind: new build waiting");
    expect(standing.glance).toBe("1 behind, build waiting");
    expect(standing.step).toBe("aaaaaaaaa is built and swaps in when this call ends; then hard refresh");
  });

  it("never lets an older reading's waiting note outvote a live call's lease answering nothing held", () => {
    const standing = standingOf({
      callLive: true,
      callWaiting: undefined,
      over: {
        rebuild: { logPath: "/l", running: false, waiting: { sha: SHA_A } },
        served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" },
      },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("stuck");
    expect(standing.headline).toBe("1 commit behind: console not rebuilt");
    expect(standing.glance).toBe("1 behind, not rebuilt");
  });

  it("says a build is held for another tab's call from the reading's own waiting note", () => {
    const standing = standingOf({
      over: {
        rebuild: { logPath: "/l", running: true, waiting: { sha: SHA_A } },
        served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" },
      },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("waiting");
    expect(standing.step).toBe("aaaaaaaaa is built and swaps in when a live voice call ends; then hard refresh");
  });

  it("never says latest when the reading's upstream tip is not the served build", () => {
    const standing = standingOf({
      over: {
        mainline: { commits: [MAINLINE[0]], limit: 50, truncated: false },
        upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T06:59:00Z", ref: "origin/main", sha: SHA_B },
      },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.step).toBe(
      "the console serves aaaaaaaaa but origin/main reads bbbbbbbbb; the next reading settles it",
    );
  });

  it("never says a held build is waiting when it is older than the page", () => {
    const standing = standingOf({
      over: { rebuild: { logPath: "/l", running: false, waiting: { sha: SHA_B } } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("current");
    expect(standing.headline).toBe("Latest build");
  });

  it("says rebuilding while a round builds the checkout's newer head", () => {
    const standing = standingOf({
      over: {
        rebuild: { logPath: "/l", running: true, waiting: undefined },
        served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" },
      },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("rebuilding");
    expect(standing.headline).toBe("1 commit behind: rebuilding");
    expect(standing.glance).toBe("1 behind, rebuilding");
    expect(standing.tone).toBe("busy");
  });

  it("names no build and no refresh while a round builds, whatever HEAD reads", () => {
    const standing = standingOf({
      over: {
        head: { sha: SHA_C },
        rebuild: { logPath: "/l", running: true, waiting: undefined },
        served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" },
      },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("rebuilding");
    expect(standing.step).toBe("the console is rebuilding; once it serves the new build, this names the step");
  });

  it("names the sync step when the checkout has not pulled the upstream", () => {
    const standing = standingOf({
      over: {
        head: { sha: SHA_B },
        served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" },
        upstream: { ahead: 0, behind: 1, fetchedAtIso: "2026-09-28T06:58:00Z", ref: "origin/main", sha: SHA_A },
      },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("unsynced");
    expect(standing.headline).toBe("1 commit behind origin/main");
    expect(standing.glance).toBe("1 behind, sync");
    expect(standing.step).toBe(
      "the checkout has not pulled them yet: `slopweaver checkout sync` pulls and rebuilds the console",
    );
  });

  it("names the refresh command and its log when the checkout moved and nothing is rebuilding", () => {
    const standing = standingOf({
      over: { served: { kind: "production", live: true, sha: SHA_B, startedIso: "2026-09-28T06:00:00Z" } },
      sha: SHA_B,
    });
    expect(standing.kind).toBe("stuck");
    expect(standing.step).toBe(
      "the checkout is at aaaaaaaaa and no rebuild is running: `bash scripts/docs-site.sh --refresh`; its log is /home/docs-site/x.refresh.log",
    );
  });

  it("says only that the page's build is outside a cut history, never a count it cannot know", () => {
    const standing = standingOf({
      over: { mainline: { commits: MAINLINE, limit: 3, truncated: true } },
      sha: SHA_D,
    });
    expect(standing.kind).toBe("reload");
    expect(standing.headline).toBe("not in origin/main's last 3: hard refresh");
    expect(standing.glance).toBe("not in last 3, refresh");
    expect(standing.missing.length).toBe(3);
  });

  it("refuses to count a build that is not on the upstream's history", () => {
    const standing = standingOf({ sha: SHA_D });
    expect(standing.kind).toBe("unknown");
    expect(standing.glance).toBe("not known");
    expect(standing.step).toBe("this build is not on origin/main's history, so how far behind it is cannot be counted");
  });

  it("never calls a server build newer when it is older than the page", () => {
    const standing = standingOf({
      over: { served: { kind: "production", live: true, sha: SHA_C, startedIso: "2026-09-28T06:00:00Z" } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.step).toBe("the console now serves ccccccccc, which is not newer than this page; reload to see it");
  });

  it("says the build carries no id when the bundle was not built by the script", () => {
    const standing = buildStanding({
      callLive: false,
      callWaiting: undefined,
      loaded: { committedIso: undefined, sha: undefined },
      nowMs: NOW_MS,
      report: report(),
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.build).toBe(undefined);
  });

  it("says a dev server recompiles rather than comparing commits", () => {
    const standing = standingOf({
      over: { served: { kind: "dev", live: true, startedIso: "2026-09-28T06:00:00Z" } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("dev");
    expect(standing.glance).toBe("dev server");
  });

  it("says the recorded console is not running rather than calling it latest", () => {
    const standing = standingOf({
      over: { served: { kind: "production", live: false, sha: SHA_A, startedIso: "2026-09-28T06:00:00Z" } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.step).toBe("the console recorded for /work/slopweaver is not running");
  });
});

describe("buildStanding — latest needs a recent fetch", () => {
  it("refuses latest when the upstream was never fetched, naming the fetch's failure", () => {
    const standing = standingOf({
      over: {
        problems: ["git fetch origin main failed: offline"],
        upstream: { ahead: 0, behind: 0, fetchedAtIso: undefined, ref: "origin/main", sha: SHA_A },
      },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.step).toBe(
      "this build matches origin/main as never fetched, so whether it is the latest is not known: git fetch origin main failed: offline",
    );
    // The failed fetch rides out as a read to mark, with the answer it last gave.
    expect(standing.upstreamUnread).toEqual({
      lastMatched: true,
      ref: "origin/main",
      why: "origin/main never fetched",
    });
  });

  it("refuses latest when the last fetch is older than the bound", () => {
    const standing = standingOf({
      over: { upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T06:54:00Z", ref: "origin/main", sha: SHA_A } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.step).toBe(
      "this build matches origin/main as last fetched 6m ago, so whether it is the latest is not known",
    );
  });

  it("refuses latest on a fetch dated after now, which only a clock set back produces", () => {
    const standing = standingOf({
      over: { upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T08:00:00Z", ref: "origin/main", sha: SHA_A } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.step).toBe(
      "this build matches origin/main as fetched at an instant after now (the clock went back), so whether it is the latest is not known",
    );
  });

  it("still says latest on a fetch a few seconds past the page's once-a-minute clock", () => {
    const standing = standingOf({
      over: { upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T07:00:40Z", ref: "origin/main", sha: SHA_A } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("current");
  });

  it("says latest at exactly the bound", () => {
    const standing = standingOf({
      over: { upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T06:55:00Z", ref: "origin/main", sha: SHA_A } },
      sha: SHA_A,
    });
    expect(standing.kind).toBe("current");
  });
});

describe("readConsoleBuildReport", () => {
  const payload = {
    head: { sha: SHA_A },
    mainline: {
      commits: [
        {
          committedIso: "2026-09-28T06:00:00Z",
          pullRequest: { number: 3, url: "https://github.com/lachiejames/slopweaver/pull/3" },
          sha: SHA_A,
          title: "newest",
        },
      ],
      limit: 50,
      truncated: false,
    },
    observedAtIso: "2026-09-28T06:59:00Z",
    problems: [],
    rebuild: { logPath: "/l", running: false },
    root: "/work/slopweaver",
    served: { kind: "production", live: true, port: 3000, sha: SHA_A, slot: ".next-serve-a", startedIso: "x" },
    upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-09-28T06:58:00Z", ref: "origin/main", sha: SHA_A },
  };

  it("reads the verb's document", () => {
    const read = readConsoleBuildReport({ payload })!;
    expect(read.served).toEqual({ kind: "production", live: true, sha: SHA_A, startedIso: "x" });
    expect(read.mainline.commits[0].pullRequest!.number).toBe(3);
    expect(read.upstream!.ref).toBe("origin/main");
    expect(read.rebuild.waiting).toBe(undefined);
  });

  it("reads a checkout with no upstream", () => {
    const { upstream: _upstream, ...noUpstream } = payload;
    expect(readConsoleBuildReport({ payload: noUpstream })!.upstream).toBe(undefined);
  });

  it("refuses a commit carrying a malformed sha", () => {
    const bad = {
      ...payload,
      mainline: { ...payload.mainline, commits: [{ ...payload.mainline.commits[0], sha: "x" }] },
    };
    expect(readConsoleBuildReport({ payload: bad })).toBe(undefined);
  });

  it("refuses a document that is not one", () => {
    expect(readConsoleBuildReport({ payload: [] })).toBe(undefined);
  });

  it("reads whether a commit changes the desktop app, and an absent flag as unknown", () => {
    const flagged = {
      ...payload,
      mainline: { ...payload.mainline, commits: [{ ...payload.mainline.commits[0], changesShell: true }] },
    };
    expect(readConsoleBuildReport({ payload: flagged })!.mainline.commits[0].changesShell).toBe(true);
    expect(readConsoleBuildReport({ payload })!.mainline.commits[0].changesShell).toBe(undefined);
  });

  it("refuses a commit whose app-change flag is not a boolean", () => {
    const bad = {
      ...payload,
      mainline: { ...payload.mainline, commits: [{ ...payload.mainline.commits[0], changesShell: "yes" }] },
    };
    expect(readConsoleBuildReport({ payload: bad })).toBe(undefined);
  });

  it("reads whether a commit changes the console, and an absent flag from an older verb as unknown", () => {
    const flagged = {
      ...payload,
      mainline: { ...payload.mainline, commits: [{ ...payload.mainline.commits[0], changesConsole: false }] },
    };
    expect(readConsoleBuildReport({ payload: flagged })!.mainline.commits[0].changesConsole).toBe(false);
    expect(readConsoleBuildReport({ payload })!.mainline.commits[0].changesConsole).toBe(undefined);
  });

  it("refuses a commit whose console-change flag is not a boolean", () => {
    const bad = {
      ...payload,
      mainline: { ...payload.mainline, commits: [{ ...payload.mainline.commits[0], changesConsole: 1 }] },
    };
    expect(readConsoleBuildReport({ payload: bad })).toBe(undefined);
  });

  it("refuses a history that repeats a commit, whose every count would overclaim", () => {
    const once = payload.mainline.commits[0];
    const repeated = { ...payload, mainline: { ...payload.mainline, commits: [once, once] } };
    expect(readConsoleBuildReport({ payload: repeated })).toBe(undefined);
  });

  describe("the installed app", () => {
    const stamp = { committedIso: "2026-10-08T06:48:50Z", sha: SHA_B, tree: "clean" };

    it("reads a verb older than the field as no comparison", () => {
      expect(readConsoleBuildReport({ payload })!.installedApp).toBe(undefined);
    });

    it("reads a comparison, with an unset fork the JSON dropped", () => {
      const compared = { ...payload, installedApp: { kind: "read", shellDiffers: false, stamp } };
      expect(readConsoleBuildReport({ payload: compared })!.installedApp).toEqual({
        forkSha: undefined,
        kind: "read",
        shellDiffers: false,
        stamp,
      });
    });

    it("reads a changed app with its fork, and an absent or unreadable bundle apart", () => {
      const changed = { ...payload, installedApp: { forkSha: SHA_C, kind: "read", shellDiffers: true, stamp } };
      expect(readConsoleBuildReport({ payload: changed })!.installedApp).toEqual({
        forkSha: SHA_C,
        kind: "read",
        shellDiffers: true,
        stamp,
      });
      const absent = { ...payload, installedApp: { kind: "absent" } };
      expect(readConsoleBuildReport({ payload: absent })!.installedApp).toEqual({ kind: "absent" });
      const unreadable = { ...payload, installedApp: { kind: "unreadable", why: "EACCES" } };
      expect(readConsoleBuildReport({ payload: unreadable })!.installedApp).toEqual({
        kind: "unreadable",
        why: "EACCES",
      });
    });

    it("refuses the whole reading when a present installed app is malformed", () => {
      const badFlag = { ...payload, installedApp: { kind: "read", shellDiffers: "no", stamp } };
      expect(readConsoleBuildReport({ payload: badFlag })).toBe(undefined);
      const badFork = { ...payload, installedApp: { forkSha: "x", kind: "read", shellDiffers: true, stamp } };
      expect(readConsoleBuildReport({ payload: badFork })).toBe(undefined);
      const badStamp = { ...payload, installedApp: { kind: "read", shellDiffers: true, stamp: { sha: SHA_B } } };
      expect(readConsoleBuildReport({ payload: badStamp })).toBe(undefined);
      const forkOnSame = { ...payload, installedApp: { forkSha: SHA_C, kind: "read", shellDiffers: false, stamp } };
      expect(readConsoleBuildReport({ payload: forkOnSame })).toBe(undefined);
      const badKind = { ...payload, installedApp: { kind: "gone" } };
      expect(readConsoleBuildReport({ payload: badKind })).toBe(undefined);
    });
  });
});
