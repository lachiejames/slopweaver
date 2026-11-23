/**
 * `checkout console`'s terminal lines and its command module's help and usage exits.
 */
import { describe, expect, it } from "vitest";

import { type ConsoleBuildReport } from "../../../../../checkouts/consoleBuild.js";
import { checkoutConsoleCommand, consoleReportLines } from "../../../../../cli/commands/checkout/consoleRun.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const REPORT: ConsoleBuildReport = {
  head: { sha: SHA_B },
  installedApp: { kind: "absent" },
  mainline: { commits: [], limit: 50, truncated: true },
  observedAtIso: "2026-09-28T07:00:00.000Z",
  problems: ["could not fetch origin/main (down) — compared against the refs already on disk"],
  rebuild: { logPath: "/h/x.refresh.log", running: true, waiting: undefined },
  root: "/work/slopweaver",
  served: {
    kind: "production",
    live: true,
    port: 3000,
    sha: SHA_B,
    slot: ".next-serve-a",
    startedIso: "2026-09-28T06:00:00Z",
  },
  upstream: { ahead: 0, behind: 1, fetchedAtIso: undefined, ref: "origin/main", sha: SHA_A },
};

describe("consoleReportLines", () => {
  it("prints the served build, HEAD, the upstream, the round, the history and the problems", () => {
    expect(consoleReportLines({ report: REPORT })).toEqual([
      "console: serving bbbbbbbbb on :3000 since 2026-09-28T06:00:00Z",
      "HEAD: bbbbbbbbb",
      "origin/main: aaaaaaaaa — HEAD is 1 behind, 0 ahead (never fetched)",
      "rebuild: running — /h/x.refresh.log",
      "mainline: 0 commit(s), older ones beyond",
      "problem: could not fetch origin/main (down) — compared against the refs already on disk",
    ]);
  });

  it("prints a held build ahead of a running round, and a fetch's instant", () => {
    const report: ConsoleBuildReport = {
      ...REPORT,
      problems: [],
      rebuild: { ...REPORT.rebuild, waiting: { pid: 9, sha: SHA_A, sinceIso: "2026-09-28T07:00:00Z" } },
      upstream: { ...REPORT.upstream!, fetchedAtIso: "2026-09-28T06:59:00.000Z" },
    };
    expect(consoleReportLines({ report }).slice(2, 4)).toEqual([
      "origin/main: aaaaaaaaa — HEAD is 1 behind, 0 ahead (fetched 2026-09-28T06:59:00.000Z)",
      "rebuild: aaaaaaaaa is built and waiting for a live voice call to end",
    ]);
  });

  it("says whether the installed app's source matches the upstream's", () => {
    const stamp = { committedIso: "2026-09-28T05:00:00Z", sha: SHA_B, tree: "clean" } as const;
    const lineFor = ({ installedApp }: { installedApp: ConsoleBuildReport["installedApp"] }): string | undefined =>
      consoleReportLines({ report: { ...REPORT, installedApp } })[3];
    expect(lineFor({ installedApp: { forkSha: undefined, kind: "read", shellDiffers: false, stamp } })).toBe(
      "app: built from bbbbbbbbb — the same app source as origin/main",
    );
    expect(lineFor({ installedApp: { forkSha: SHA_A, kind: "read", shellDiffers: true, stamp } })).toBe(
      "app: built from bbbbbbbbb — origin/main's app differs: a new version is available",
    );
    expect(lineFor({ installedApp: { forkSha: undefined, kind: "read", shellDiffers: undefined, stamp } })).toBe(
      "app: built from bbbbbbbbb — not compared with origin/main",
    );
    expect(
      lineFor({
        installedApp: { forkSha: undefined, kind: "read", shellDiffers: undefined, stamp: { ...stamp, tree: "dirty" } },
      }),
    ).toBe("app: built from bbbbbbbbb with uncommitted app changes");
    expect(lineFor({ installedApp: { kind: "unreadable", why: "x" } })).toBe("app: installed, build not known");
    expect(lineFor({ installedApp: { kind: "absent" } })).toBe("rebuild: running — /h/x.refresh.log");
  });

  it("names a dev server that is down, and no server at all", () => {
    const dev: ConsoleBuildReport = {
      ...REPORT,
      served: { kind: "dev", live: false, port: 3001, startedIso: "2026-09-28T06:00:00Z" },
    };
    expect(consoleReportLines({ report: dev })[0]).toBe("console: a dev server on :3001 (DOWN)");
    const none: ConsoleBuildReport = {
      ...REPORT,
      head: undefined,
      rebuild: { ...REPORT.rebuild, running: false },
      served: { kind: "none" },
      upstream: undefined,
    };
    expect(consoleReportLines({ report: none }).slice(0, 2)).toEqual([
      "console: no server is recorded for /work/slopweaver",
      "mainline: 0 commit(s), older ones beyond",
    ]);
  });
});

describe("checkoutConsoleCommand", () => {
  it("runs its own --help and exits ok", () => {
    expect(checkoutConsoleCommand(["node", "cli", "checkout", "console", "--help"])).toBe(0);
  });

  it("refuses an unknown flag with the usage exit code", () => {
    expect(checkoutConsoleCommand(["node", "cli", "checkout", "console", "--nope"])).toBe(2);
  });
});
