/*
 * The sidebar's one update line: the page's and the app's standings joined into one standing — up to date, an update
 * with every change it brings in one list, something under way, or not known — never a console half and an app half.
 */
import { describe, expect, it } from "vitest";

import type { BuildStanding } from "../../lib/buildStanding";
import type { ConsoleCommit } from "../../lib/buildStandingReport";
import type { ShellStanding } from "../../lib/shellStandingWords";
import type { UpdateIntent } from "../../lib/updateAction";
import { experienceChanges, updateStanding } from "../../lib/updateStanding";

/** A commit on origin/main's line. */
const commit = ({
  sha,
  changesShell = false,
  changesConsole = false,
}: {
  sha: string;
  changesShell?: boolean;
  changesConsole?: boolean;
}): ConsoleCommit => ({
  changesConsole,
  changesShell,
  committedIso: "2026-10-10T12:00:00.000Z",
  pullRequest: undefined,
  sha,
  title: `change ${sha}`,
});

/** origin/main newest first: e, d, c, b, a. */
const MAINLINE = [
  commit({ sha: "e" }),
  commit({ changesShell: true, sha: "d" }),
  commit({ sha: "c" }),
  commit({ changesShell: true, sha: "b" }),
  commit({ sha: "a" }),
];

/** A console standing with the fields the line reads. */
const page = (over: Partial<BuildStanding> = {}): BuildStanding => ({
  build: "rebuilt 5m ago",
  checked: "origin/main checked 2m ago",
  glance: "latest",
  headline: "Latest build",
  kind: "current",
  missing: [],
  step: undefined,
  tone: "ok",
  ...over,
});

/** An app standing with the fields the line reads. */
const app = (over: Partial<ShellStanding> = {}): ShellStanding => ({
  build: "built from aaaaaaaaa, commit 3.0h ago",
  changing: [],
  fix: "none",
  glance: "latest",
  headline: "App on the latest build",
  step: undefined,
  tone: "ok",
  ...over,
});

const NONE: UpdateIntent = { kind: "none" };
const INSTALL: UpdateIntent = { endsCall: false, kind: "install" };

describe("experienceChanges", () => {
  it("joins the page's missing commits and the app's changing ones once each, in origin/main's order", () => {
    const changes = experienceChanges({
      app: app({ changing: [MAINLINE[3], MAINLINE[1]] }),
      mainline: MAINLINE,
      page: page({ missing: [MAINLINE[0], MAINLINE[1]] }),
    });
    expect(changes.map((change) => change.sha)).toEqual(["e", "d", "b"]);
  });

  it("keeps a change the mainline reading does not carry, after the placed ones and once", () => {
    const outside = commit({ sha: "z" });
    const changes = experienceChanges({
      app: app({ changing: [outside, MAINLINE[1]] }),
      mainline: MAINLINE,
      page: page({ missing: [outside, MAINLINE[0]] }),
    });
    expect(changes.map((change) => change.sha)).toEqual(["e", "d", "z"]);
  });

  it("is the page's alone in a browser, and empty when nothing is missing", () => {
    expect(
      experienceChanges({ app: undefined, mainline: MAINLINE, page: page({ missing: [MAINLINE[0]] }) }).map(
        (change) => change.sha,
      ),
    ).toEqual(["e"]);
    expect(experienceChanges({ app: app(), mainline: MAINLINE, page: page() })).toEqual([]);
  });
});

describe("updateStanding", () => {
  it("says up to date only when the page is on the latest build and the app has nothing to get", () => {
    expect(updateStanding({ app: app(), changes: [], intent: NONE, page: page(), pressable: false })).toEqual({
      changes: [],
      kind: "current",
      line: "Up to date",
      notes: [],
      title:
        "Console: Latest build · rebuilt 5m ago\nApp: App on the latest build · built from aaaaaaaaa, commit 3.0h ago",
      tone: "ok",
      unread: [],
    });
    expect(updateStanding({ app: undefined, changes: [], intent: NONE, page: page(), pressable: false }).line).toBe(
      "Up to date",
    );
  });

  it("says one update with every change counted, and leaves the step to the button when there is one", () => {
    const changes = [MAINLINE[0], MAINLINE[1], MAINLINE[3]];
    const standing = updateStanding({
      app: app({ fix: "install", step: "install it", tone: "attention" }),
      changes,
      intent: INSTALL,
      page: page({ kind: "reload", step: "hard refresh (⌘⇧R) loads eeeeeeeee", tone: "attention" }),
      pressable: true,
    });
    expect(standing.kind).toBe("available");
    expect(standing.line).toBe("Update available · 3 changes, 2 in the app");
    expect(standing.notes).toEqual([]);
    expect(standing.changes).toEqual(changes);
    expect(standing.tone).toBe("attention");
  });

  it("counts a change in the app once whichever flags say so, and never one whose place was not read", () => {
    const changes = [
      commit({ changesConsole: true, changesShell: true, sha: "p" }),
      commit({ changesConsole: true, sha: "q" }),
      { ...commit({ sha: "r" }), changesConsole: undefined, changesShell: undefined },
      { ...commit({ sha: "s" }), changesConsole: undefined },
      commit({ sha: "t" }),
    ];
    const standing = updateStanding({ app: app(), changes, intent: INSTALL, page: page(), pressable: true });
    expect(standing.line).toBe("Update available · 5 changes, 2 in the app");
  });

  it("never says up to date over a change still listed, and keeps the list", () => {
    const standing = updateStanding({
      app: app(),
      changes: [MAINLINE[2]],
      intent: NONE,
      page: page(),
      pressable: false,
    });
    expect(standing.kind).toBe("unknown");
    expect(standing.line).toBe("Update status not known");
    expect(standing.changes).toEqual([MAINLINE[2]]);
  });

  it("never invents a count when the app differs but cannot be placed", () => {
    const standing = updateStanding({
      app: app({ fix: "install", tone: "attention" }),
      changes: [],
      intent: INSTALL,
      page: page(),
      pressable: true,
    });
    expect(standing.line).toBe("Update available");
  });

  it("says the one step in words when no button carries it — the app's first, since it rebuilds the page too", () => {
    expect(
      updateStanding({
        app: app({ fix: "install", step: "`slopweaver desktop install` from the main checkout", tone: "attention" }),
        changes: [MAINLINE[0]],
        intent: INSTALL,
        page: page({ kind: "reload", step: "hard refresh (⌘⇧R) loads eeeeeeeee", tone: "attention" }),
        pressable: false,
      }).notes,
    ).toEqual(["`slopweaver desktop install` from the main checkout"]);
    expect(
      updateStanding({
        app: undefined,
        changes: [MAINLINE[0]],
        intent: { endsCall: false, kind: "reload" },
        page: page({ kind: "reload", step: "hard refresh (⌘⇧R) loads eeeeeeeee", tone: "attention" }),
        pressable: false,
      }),
    ).toEqual({
      changes: [MAINLINE[0]],
      kind: "available",
      line: "Update available · 1 change",
      notes: ["hard refresh (⌘⇧R) loads eeeeeeeee"],
      title: "Console: Latest build · rebuilt 5m ago · hard refresh (⌘⇧R) loads eeeeeeeee",
      tone: "attention",
      unread: [],
    });
  });

  it("says what is under way in the intent's own words", () => {
    const standing = updateStanding({
      app: app(),
      changes: [MAINLINE[0]],
      intent: { kind: "busy", label: "Building update…" },
      page: page({ kind: "rebuilding", tone: "busy" }),
      pressable: false,
    });
    expect(standing.kind).toBe("busy");
    expect(standing.line).toBe("Building update…");
    expect(standing.tone).toBe("busy");
  });

  it("never reads a build it cannot establish as up to date, and says why", () => {
    expect(
      updateStanding({
        app: app({
          glance: "unchecked",
          step: "whether origin/main has landed anything is not known",
          tone: "unknown",
        }),
        changes: [],
        intent: NONE,
        page: page(),
        pressable: true,
      }),
    ).toEqual({
      changes: [],
      kind: "unknown",
      line: "Update status not known",
      notes: ["whether origin/main has landed anything is not known"],
      title:
        "Console: Latest build · rebuilt 5m ago\nApp: App on the latest build · built from aaaaaaaaa, commit 3.0h ago · whether origin/main has landed anything is not known",
      tone: "unknown",
      unread: [],
    });
    expect(
      updateStanding({
        app: undefined,
        changes: [],
        intent: NONE,
        page: page({ headline: "Build not established", kind: "unknown", step: undefined, tone: "unknown" }),
        pressable: false,
      }).notes,
    ).toEqual(["Build not established"]);
  });

  // A fetch that failed or is old is a failed read — a staleness mark beside the answer it last gave, never the
  // sentence "Update status not known" in the line's place.
  it("marks an upstream fetch that is not current beside the answer it last gave, never a sentence", () => {
    const fetch = { lastMatched: true, ref: "origin/main", why: "origin/main last fetched 3.0h ago" };
    const standing = updateStanding({
      app: app({ glance: "unchecked", tone: "unknown", upstreamUnread: fetch }),
      changes: [],
      intent: NONE,
      page: page({ kind: "unknown", tone: "unknown", upstreamUnread: fetch }),
      pressable: true,
    });
    expect([standing.kind, standing.line, standing.notes, standing.unread]).toEqual([
      "unknown",
      "Up to date",
      [],
      [{ subject: "whether origin/main has moved past what you run", why: "origin/main last fetched 3.0h ago" }],
    ]);
    expect(
      updateStanding({
        app: undefined,
        changes: [],
        intent: NONE,
        page: page({
          kind: "unknown",
          tone: "unknown",
          upstreamUnread: { lastMatched: false, ref: "the upstream", why: "the upstream never fetched" },
        }),
        pressable: false,
      }).line,
    ).toBe("");
  });

  // Beside another unknown, the old fetch is still the mark's, and the note says only the other reason.
  it("says the other reason in words when something besides a failed read keeps it unknown, the fetch marked", () => {
    const fetch = { lastMatched: true, ref: "origin/main", why: "origin/main last fetched 3.0h ago" };
    const standing = updateStanding({
      app: app({ glance: "from source", headline: "App run from source", step: undefined, tone: "unknown" }),
      changes: [],
      intent: NONE,
      page: page({
        kind: "unknown",
        step: "this build matches origin/main as last fetched 3.0h ago, so whether it is the latest is not known",
        tone: "unknown",
        upstreamUnread: fetch,
      }),
      pressable: true,
    });
    expect([standing.line, standing.notes, standing.unread]).toEqual([
      "Update status not known",
      ["App run from source"],
      [{ subject: "whether origin/main has moved past what you run", why: "origin/main last fetched 3.0h ago" }],
    ]);
  });

  it("marks an app answer that would not read, with no words when nothing earlier was read", () => {
    const standing = updateStanding({
      app: app({
        glance: "not known",
        headline: "App build not known",
        shellUnread: { kept: false, why: "the app did not answer: gone" },
        step: undefined,
        tone: "unknown",
      }),
      changes: [],
      intent: NONE,
      page: page(),
      pressable: true,
    });
    expect([standing.kind, standing.line, standing.notes, standing.unread]).toEqual([
      "unknown",
      "",
      [],
      [{ subject: "the app's own build", why: "the app did not answer: gone" }],
    ]);
  });

  it("keeps the mark on a kept app answer, whatever the line says", () => {
    const standing = updateStanding({
      app: app({ shellUnread: { kept: true, why: "the app did not answer: gone" } }),
      changes: [],
      intent: NONE,
      page: page(),
      pressable: true,
    });
    expect([standing.kind, standing.line, standing.unread]).toEqual([
      "current",
      "Up to date",
      [{ subject: "the app's own build", why: "the app did not answer: gone" }],
    ]);
  });
});
