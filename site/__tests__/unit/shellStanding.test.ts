/*
 * The app half of the sidebar's staleness line: the commit the running app was built from, whether origin/main has landed anything that
 * changes it since, and whether a newer install is waiting on a relaunch.
 */
import { describe, expect, it } from "vitest";

import type { ConsoleBuildReport, ConsoleCommit } from "../../lib/buildStandingReport";
import type { ShellStamp } from "../../lib/desktopShellWire";
import { type ShellReading, shellStanding, shellUnreadable } from "../../lib/shellStanding";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const NOW_MS = Date.parse("2026-10-06T03:00:00Z");

/** One mainline commit, newest first by position. */
const commit = ({
  sha,
  title,
  changesShell,
}: {
  sha: string;
  title: string;
  changesShell: boolean | undefined;
}): ConsoleCommit => ({
  // Always true, so no assertion below can be standing on it: the app's standing reads the shell flag alone.
  changesConsole: true,
  changesShell,
  committedIso: "2026-10-05T16:54:25Z",
  pullRequest: undefined,
  sha,
  title,
});

/** The incident's mainline: the orb's floor (A) and the whole-screen glow (B) change the app; C does not. */
const MAINLINE: readonly ConsoleCommit[] = [
  commit({ changesShell: true, sha: SHA_A, title: "The voice's orb rests clear of an app's bottom bar" }),
  commit({ changesShell: true, sha: SHA_B, title: "The whole-screen glow" }),
  commit({ changesShell: false, sha: SHA_C, title: "Update dependency ai" }),
  commit({ changesShell: false, sha: SHA_D, title: "older" }),
];

/** A reading of origin/main at A. */
const report = (over: Partial<ConsoleBuildReport> = {}): ConsoleBuildReport => ({
  head: { sha: SHA_A },
  installedApp: undefined,
  mainline: { commits: MAINLINE, limit: 50, truncated: false },
  observedAtIso: "2026-10-06T02:59:00Z",
  problems: [],
  rebuild: { logPath: "/home/docs-site/x.refresh.log", running: false, waiting: undefined },
  root: "/work/slopweaver",
  served: { kind: "production", live: true, sha: SHA_A, startedIso: "2026-10-06T02:00:00Z" },
  upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-10-06T02:58:00Z", ref: "origin/main", sha: SHA_A },
  ...over,
});

/** A stamp at a commit, committed three hours before the clock. */
const stamp = ({ sha, tree = "clean" }: { sha: string; tree?: "clean" | "dirty" }): ShellStamp => ({
  committedIso: "2026-10-06T00:00:00Z",
  sha,
  tree,
});

/** A packaged app's answer. */
const read = ({
  running,
  installed,
}: {
  running: ShellStamp | undefined;
  installed: ShellStamp | undefined;
}): ShellReading => ({ build: { dev: false, installed, running }, kind: "read" });

const standingOf = ({
  shell,
  over = {},
  callLive = false,
}: {
  shell: ShellReading;
  over?: Partial<ConsoleBuildReport>;
  callLive?: boolean;
}): ReturnType<typeof shellStanding> => shellStanding({ callLive, nowMs: NOW_MS, report: report(over), shell });

describe("shellStanding", () => {
  it("draws no line in a browser or before the app has answered", () => {
    expect(standingOf({ shell: { kind: "browser" } })).toBe(undefined);
    expect(standingOf({ shell: { kind: "pending" } })).toBe(undefined);
  });

  it("names the install under an app built before it could say its build", () => {
    expect(standingOf({ shell: { kind: "no-method" } })).toEqual({
      build: undefined,
      changing: [],
      fix: "install",
      glance: "not known, install",
      headline: "App build not known",
      step: "this app was installed before builds were stamped; `slopweaver desktop install` from the main checkout: it quits the app and reopens it on the new build",
      tone: "attention",
    });
  });

  it("holds the install until a live call ends, saying why", () => {
    expect(standingOf({ callLive: true, shell: { kind: "no-method" } })!.step).toBe(
      "this app was installed before builds were stamped; after this call, `slopweaver desktop install` from the main checkout: it quits the app, and would end the call with it",
    );
  });

  it("names the commit and every landed commit that changes the app, for a stamped build behind them", () => {
    const standing = standingOf({ shell: read({ installed: stamp({ sha: SHA_C }), running: stamp({ sha: SHA_C }) }) });
    expect(standing!.headline).toBe("New version available: 2 changes to the app");
    expect(standing!.glance).toBe("update available");
    expect(standing!.build).toBe("built from ccccccccc, commit 3.0h ago");
    expect(standing!.changing.map((change) => change.sha)).toEqual([SHA_A, SHA_B]);
    expect(standing!.tone).toBe("attention");
    expect(standing!.step).toBe(
      "`slopweaver desktop install` from the main checkout: it quits the app and reopens it on the new build",
    );
  });

  it("is current when nothing it is missing changes the app", () => {
    const shell = read({ installed: stamp({ sha: SHA_C }), running: stamp({ sha: SHA_C }) });
    const plain = commit({ changesShell: false, sha: SHA_B, title: "docs" });
    const over = { mainline: { commits: [plain, ...MAINLINE.slice(2)], limit: 50, truncated: false } };
    expect(standingOf({ over, shell })).toEqual({
      build: "built from ccccccccc, commit 3.0h ago",
      changing: [],
      fix: "none",
      glance: "current",
      headline: "App current: 1 commit behind, none change it",
      step: undefined,
      tone: "ok",
    });
  });

  it("is on the latest build at origin/main's tip", () => {
    const standing = standingOf({ shell: read({ installed: stamp({ sha: SHA_A }), running: stamp({ sha: SHA_A }) }) });
    expect(standing!.headline).toBe("App on the latest build");
    expect(standing!.glance).toBe("latest");
    expect(standing!.tone).toBe("ok");
  });

  it("says a relaunch is pending when the installed app is not the running one", () => {
    const standing = standingOf({ shell: read({ installed: stamp({ sha: SHA_A }), running: stamp({ sha: SHA_C }) }) });
    expect(standing).toEqual({
      build: "built from ccccccccc, commit 3.0h ago",
      changing: [],
      fix: "relaunch",
      glance: "relaunch",
      headline: "App relaunch pending",
      step: "the installed app is aaaaaaaaa; quit and reopen Slopweaver to run it",
      tone: "attention",
    });
  });

  it("says a relaunch is pending when an unstamped app runs over a stamped install", () => {
    const standing = standingOf({ shell: read({ installed: stamp({ sha: SHA_A }), running: undefined }) });
    expect(standing!.headline).toBe("App relaunch pending");
    expect(standing!.build).toBe(undefined);
  });

  it("never counts a commit whose flag could not be read as leaving the app alone", () => {
    const unread = commit({ changesShell: undefined, sha: SHA_B, title: "unread" });
    const standing = standingOf({
      over: { mainline: { commits: [unread, ...MAINLINE.slice(2)], limit: 50, truncated: false } },
      shell: read({ installed: stamp({ sha: SHA_C }), running: stamp({ sha: SHA_C }) }),
    });
    expect(standing!.headline).toBe("New version may be available: this build is 1 commit behind");
    expect(standing!.glance).toBe("update may be available");
    expect(standing!.tone).toBe("unknown");
    expect(standing!.step).toBe(
      "which of those change the app could not be read; `slopweaver desktop install` from the main checkout: it quits the app and reopens it on the new build",
    );
  });

  it("never says none change it for an app older than a cut window, whose flags reach no further", () => {
    const old = "e".repeat(40);
    const plain = MAINLINE.map((each) => ({ ...each, changesShell: false }));
    const standing = standingOf({
      over: { mainline: { commits: plain, limit: 4, truncated: true } },
      shell: read({ installed: stamp({ sha: old }), running: stamp({ sha: old }) }),
    });
    expect(standing!.headline).toBe("New version may be available: this build is not in origin/main's last 4");
    expect(standing!.glance).toBe("update may be available");
    expect(standing!.tone).toBe("attention");
    expect(standing!.step).toBe(
      "`slopweaver desktop install` from the main checkout: it quits the app and reopens it on the new build",
    );
  });

  it("counts nothing for a build outside a cut window, which may already hold what it shows", () => {
    const old = "e".repeat(40);
    const standing = standingOf({
      over: { mainline: { commits: MAINLINE, limit: 4, truncated: true } },
      shell: read({ installed: stamp({ sha: old }), running: stamp({ sha: old }) }),
    });
    expect(standing!.headline).toBe("New version may be available: this build is not in origin/main's last 4");
    expect(standing!.glance).toBe("update may be available");
    expect(standing!.changing).toEqual([]);
  });

  it("lists nothing for a build outside a cut window even when a flag in it could not be read", () => {
    const old = "e".repeat(40);
    const unread = commit({ changesShell: undefined, sha: SHA_B, title: "unread" });
    const standing = standingOf({
      over: { mainline: { commits: [MAINLINE[0], unread, ...MAINLINE.slice(2)], limit: 4, truncated: true } },
      shell: read({ installed: stamp({ sha: old }), running: stamp({ sha: old }) }),
    });
    expect(standing!.headline).toBe("New version may be available: this build is not in origin/main's last 4");
    expect(standing!.changing).toEqual([]);
  });

  it("never says current or latest when origin/main was last fetched too long ago", () => {
    const over = {
      upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-10-05T21:00:00Z", ref: "origin/main", sha: SHA_A },
    };
    const standing = standingOf({
      over,
      shell: read({ installed: stamp({ sha: SHA_A }), running: stamp({ sha: SHA_A }) }),
    });
    expect(standing).toEqual({
      build: "built from aaaaaaaaa, commit 3.0h ago",
      changing: [],
      fix: "none",
      glance: "0 behind, unchecked",
      headline: "App 0 commits behind origin/main as last fetched 6.0h ago",
      step: "whether origin/main has landed anything since that changes the app is not known",
      tone: "unknown",
      upstreamUnread: { lastMatched: true, ref: "origin/main", why: "origin/main last fetched 6.0h ago" },
    });
  });

  it("still names the install over a stale fetch when what it already knows changes the app, as only a maybe", () => {
    const over = {
      upstream: { ahead: 0, behind: 0, fetchedAtIso: undefined, ref: "origin/main", sha: SHA_A },
    };
    const standing = standingOf({
      over,
      shell: read({ installed: stamp({ sha: SHA_C }), running: stamp({ sha: SHA_C }) }),
    });
    expect(standing!.tone).toBe("attention");
    expect(standing!.headline).toBe("New version may be available: 2 changes to the app as never fetched");
    expect(standing!.glance).toBe("update may be available");
    expect(standing!.changing.map((change) => change.sha)).toEqual([SHA_A, SHA_B]);
  });

  it("says only that a new version may be available for a build whose local edits may already hold it", () => {
    const dirty = stamp({ sha: SHA_C, tree: "dirty" });
    const standing = standingOf({ shell: read({ installed: dirty, running: dirty }) });
    expect(standing!.headline).toBe("New version may be available: 2 changes to the app since this build's commit");
    expect(standing!.glance).toBe("update may be available");
    expect(standing!.changing.map((change) => change.sha)).toEqual([SHA_A, SHA_B]);
  });

  it("says a relaunch is pending when the installed build of the same commit differs in its local changes", () => {
    const standing = standingOf({
      shell: read({ installed: stamp({ sha: SHA_A }), running: stamp({ sha: SHA_A, tree: "dirty" }) }),
    });
    expect(standing!.headline).toBe("App relaunch pending");
  });

  it("says when the app was built off origin/main's history", () => {
    const off = "f".repeat(40);
    const standing = standingOf({ shell: read({ installed: stamp({ sha: off }), running: stamp({ sha: off }) }) });
    expect(standing!.headline).toBe("App off the line");
    expect(standing!.glance).toBe("off the line");
    expect(standing!.tone).toBe("unknown");
  });

  it("marks a build carrying uncommitted app changes, and never calls it origin/main's latest", () => {
    const dirty = stamp({ sha: SHA_A, tree: "dirty" });
    expect(standingOf({ shell: read({ installed: dirty, running: dirty }) })).toEqual({
      build: "built from aaaaaaaaa, commit 3.0h ago (with uncommitted app changes)",
      changing: [],
      fix: "install",
      glance: "local changes",
      headline: "App built with uncommitted changes",
      step: "it is not origin/main's app; `slopweaver desktop install` from the main checkout: it quits the app and reopens it on the new build",
      tone: "unknown",
    });
  });

  describe("by the app's own source, when the verb compared this very build", () => {
    /** A pre-squash branch head: on no first-parent line, its app byte-identical to origin/main's. */
    const PRE_SQUASH = "e".repeat(40);
    const plain = MAINLINE.map((each) => ({ ...each, changesShell: false }));
    const cut = { commits: plain, limit: 4, truncated: true };
    const compared = ({
      sha,
      shellDiffers,
      forkSha = undefined,
    }: {
      sha: string;
      shellDiffers: boolean | undefined;
      forkSha?: string | undefined;
    }): Partial<ConsoleBuildReport> => ({
      installedApp: { forkSha, kind: "read", shellDiffers, stamp: stamp({ sha }) },
    });

    it("calls a pre-squash build current when the verb found its app source unchanged", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const standing = standingOf({
        over: { ...compared({ sha: PRE_SQUASH, shellDiffers: false }), mainline: cut },
        shell: read({ installed: own, running: own }),
      });
      expect(standing).toEqual({
        build: "built from eeeeeeeee, commit 3.0h ago",
        changing: [],
        fix: "none",
        glance: "current",
        headline: "App current: no change to it since your build",
        step: undefined,
        tone: "ok",
      });
    });

    it("is on the latest build when its unchanged source is origin/main's tip itself", () => {
      const own = stamp({ sha: SHA_A });
      const standing = standingOf({
        over: compared({ sha: SHA_A, shellDiffers: false }),
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("App on the latest build");
      expect(standing!.glance).toBe("latest");
    });

    it("never calls an unchanged source current over a stale fetch", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const standing = standingOf({
        over: {
          ...compared({ sha: PRE_SQUASH, shellDiffers: false }),
          upstream: { ahead: 0, behind: 0, fetchedAtIso: undefined, ref: "origin/main", sha: SHA_A },
        },
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("App matches origin/main as never fetched");
      expect(standing!.glance).toBe("unchecked");
      expect(standing!.tone).toBe("unknown");
    });

    it("says only that a new version may be available when a changed source was judged against a stale fetch", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const standing = standingOf({
        over: {
          ...compared({ forkSha: SHA_B, sha: PRE_SQUASH, shellDiffers: true }),
          upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-10-05T21:00:00Z", ref: "origin/main", sha: SHA_A },
        },
        shell: read({ installed: own, running: own }),
      });
      expect(standing).toEqual({
        build: "built from eeeeeeeee, commit 3.0h ago",
        changing: [],
        fix: "install",
        glance: "update may be available",
        headline: "New version may be available: this build's app differed from origin/main's as last fetched 6.0h ago",
        step: "`slopweaver desktop install` from the main checkout: it quits the app and reopens it on the new build",
        tone: "unknown",
      });
    });

    it("places a changed off-line build by where it forked, listing only the changes after the fork", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const standing = standingOf({
        over: compared({ forkSha: SHA_B, sha: PRE_SQUASH, shellDiffers: true }),
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("New version available: 1 change to the app");
      expect(standing!.glance).toBe("update available");
      expect(standing!.changing.map((change) => change.sha)).toEqual([SHA_A]);
      expect(standing!.tone).toBe("attention");
    });

    it("counts nothing for a fork the window cannot place, older or off the line", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const outside = "9".repeat(40);
      const standing = standingOf({
        over: {
          ...compared({ forkSha: outside, sha: PRE_SQUASH, shellDiffers: true }),
          mainline: { commits: MAINLINE, limit: 4, truncated: true },
        },
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("New version available: this build's app differs from origin/main's");
      expect(standing!.glance).toBe("update available");
      expect(standing!.changing).toEqual([]);
    });

    it("lists nothing and counts nothing for a changed off-line build whose fork could not be read", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const standing = standingOf({
        over: { ...compared({ sha: PRE_SQUASH, shellDiffers: true }), mainline: { ...cut, commits: MAINLINE } },
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("New version available: this build's app differs from origin/main's");
      expect(standing!.glance).toBe("update available");
      expect(standing!.changing).toEqual([]);
    });

    it("says the app differs when a placed build is missing nothing flagged", () => {
      const own = stamp({ sha: SHA_C });
      const standing = standingOf({
        over: { ...compared({ sha: SHA_C, shellDiffers: true }), mainline: { ...cut, truncated: false } },
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("New version available: this build's app differs from origin/main's");
    });

    it("reads by commit when the verb's stamp is another build than the running one", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const standing = standingOf({
        over: { ...compared({ sha: SHA_C, shellDiffers: false }), mainline: cut },
        shell: read({ installed: own, running: own }),
      });
      expect(standing!.headline).toBe("New version may be available: this build is not in origin/main's last 4");
    });

    it("reads by commit when the verb did not compare, or the app could not read its installed stamp", () => {
      const own = stamp({ sha: PRE_SQUASH });
      const uncompared = standingOf({
        over: { ...compared({ sha: PRE_SQUASH, shellDiffers: undefined }), mainline: cut },
        shell: read({ installed: own, running: own }),
      });
      expect(uncompared!.glance).toBe("update may be available");
      const noInstalled = standingOf({
        over: { ...compared({ sha: PRE_SQUASH, shellDiffers: false }), mainline: cut },
        shell: read({ installed: undefined, running: own }),
      });
      expect(noInstalled!.glance).toBe("update may be available");
    });
  });

  it("says a run from source has no build to compare, and an unreadable answer is not one", () => {
    expect(
      standingOf({ shell: { build: { dev: true, installed: undefined, running: undefined }, kind: "read" } })!.headline,
    ).toBe("App run from source");
    expect(standingOf({ shell: { kind: "unreadable", last: undefined, why: "no build" } })!.tone).toBe("unknown");
  });

  // An answer that would not read is a failed read — marked, never the sentence in the line's place, and a
  // failed re-ask keeps the build its last good answer gave.
  it("marks an unreadable answer, saying nothing in words, and keeps the build the last good answer gave", () => {
    expect(standingOf({ shell: { kind: "unreadable", last: undefined, why: "the app did not answer: gone" } })).toEqual(
      {
        build: undefined,
        changing: [],
        fix: "none",
        glance: "not known",
        headline: "App build not known",
        shellUnread: { kept: false, why: "the app did not answer: gone" },
        step: undefined,
        tone: "unknown",
      },
    );
    const good = read({ installed: stamp({ sha: SHA_A }), running: stamp({ sha: SHA_A }) });
    const kept = standingOf({ shell: shellUnreadable({ was: good, why: "the app did not answer: gone" }) });
    expect([kept!.headline, kept!.tone, kept!.shellUnread]).toEqual([
      "App on the latest build",
      "ok",
      { kept: true, why: "the app did not answer: gone" },
    ]);
  });
});

describe("shellUnreadable", () => {
  it("keeps the last build read across failed asks, and has none before the first answer", () => {
    const build = { dev: false, installed: undefined, running: stamp({ sha: SHA_A }) };
    const once = shellUnreadable({ was: { build, kind: "read" }, why: "first" });
    expect(once).toEqual({ kind: "unreadable", last: build, why: "first" });
    expect(shellUnreadable({ was: once, why: "second" })).toEqual({ kind: "unreadable", last: build, why: "second" });
    expect(shellUnreadable({ was: { kind: "pending" }, why: "first" })).toEqual({
      kind: "unreadable",
      last: undefined,
      why: "first",
    });
  });
});
