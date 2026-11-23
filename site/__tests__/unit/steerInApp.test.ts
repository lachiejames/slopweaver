/*
 * Whether a steer's landed fix is in what the owner runs or waiting for their app to update: a fix that changes the
 * app waits until the app restarts on the latest version. Each arm is driven over a mainline reading shaped as `checkout console --json`
 * carries one, newest first.
 */
import { describe, expect, it } from "vitest";

import type { ConsoleBuildReport, ConsoleCommit } from "../../lib/buildStandingReport";
import type { ShellStamp } from "../../lib/desktopShellWire";
import type { ShellReading } from "../../lib/shellStanding";
import { type RunningBuilds, steerInApp } from "../../lib/steerInApp";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const SHA_OFF = "e".repeat(40);

/** A pull request's address on the repository the console is built from. */
function pr({ number }: { number: number }): string {
  return `https://github.com/lachiejames/slopweaver/pull/${String(number)}`;
}

/** One mainline commit landed through a pull request. */
const commit = ({
  sha,
  number,
  committedIso,
  changesShell,
}: {
  sha: string;
  number: number;
  committedIso: string;
  changesShell: boolean | undefined;
}): ConsoleCommit => ({
  // Always true, so no assertion below can be standing on it: a landing is placed by the shell flag alone.
  changesConsole: true,
  changesShell,
  committedIso,
  pullRequest: { number, url: pr({ number }) },
  sha,
  title: `change ${String(number)}`,
});

/** A landing on the console's own repository. */
const landed = ({ number, mergedIso }: { number: number; mergedIso: string }) => ({
  mergedIso,
  number,
  url: pr({ number }),
});

/** origin/main as last read: A (#4, app) newest, then B (#3, console only), C (#2, app), D (#1, console only). */
const MAINLINE: readonly ConsoleCommit[] = [
  commit({ changesShell: true, committedIso: "2026-10-10T16:00:00Z", number: 4, sha: SHA_A }),
  commit({ changesShell: false, committedIso: "2026-10-10T15:00:00Z", number: 3, sha: SHA_B }),
  commit({ changesShell: true, committedIso: "2026-10-10T14:00:00Z", number: 2, sha: SHA_C }),
  commit({ changesShell: false, committedIso: "2026-10-10T13:00:00Z", number: 1, sha: SHA_D }),
];

/** A reading of origin/main at A, its window cut at four. */
const report = (over: Partial<ConsoleBuildReport> = {}): ConsoleBuildReport => ({
  head: { sha: SHA_A },
  installedApp: undefined,
  mainline: { commits: MAINLINE, limit: 4, truncated: true },
  observedAtIso: "2026-10-10T16:05:00Z",
  problems: [],
  rebuild: { logPath: "/home/docs-site/x.refresh.log", running: false, waiting: undefined },
  root: "/work/slopweaver",
  served: { kind: "production", live: true, sha: SHA_A, startedIso: "2026-10-10T16:02:00Z" },
  upstream: { ahead: 0, behind: 0, fetchedAtIso: "2026-10-10T16:04:00Z", ref: "origin/main", sha: SHA_A },
  ...over,
});

/** A clean stamp at a commit. */
const stamp = ({ sha }: { sha: string }): ShellStamp => ({ committedIso: "2026-10-10T12:00:00Z", sha, tree: "clean" });

/** A packaged app running the build at `sha`, installed as the same build. */
const app = ({ sha }: { sha: string }): ShellReading => ({
  build: { dev: false, installed: stamp({ sha }), running: stamp({ sha }) },
  kind: "read",
});

/** The builds the owner runs: this page at `page`, the app as given. */
const running = ({
  page,
  shell,
  over = {},
}: {
  page: string | undefined;
  shell: ShellReading;
  over?: Partial<ConsoleBuildReport>;
}): RunningBuilds => ({ loadedSha: page, report: report(over), shell });

describe("steerInApp", () => {
  it("is waiting for the owner's app to update when the page they run predates the fix", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T15:00:00Z", number: 3 }),
        running: running({ page: SHA_C, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "awaiting-update" });
  });

  it("is in the app once the page carries a fix that does not change the app, whatever app the owner runs", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T15:00:00Z", number: 3 }),
        running: running({ page: SHA_A, shell: app({ sha: SHA_D }) }),
      }),
    ).toEqual({ kind: "in-app" });
  });

  it("is waiting when the page carries an app fix but the running app was built before it", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T16:00:00Z", number: 4 }),
        running: running({ page: SHA_A, shell: app({ sha: SHA_B }) }),
      }),
    ).toEqual({ kind: "awaiting-update" });
  });

  it("is in the app when both the page and the running app were built at or after the fix", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T14:00:00Z", number: 2 }),
        running: running({ page: SHA_B, shell: app({ sha: SHA_C }) }),
      }),
    ).toEqual({ kind: "in-app" });
  });

  it("is in the app when the verb found this very app build's source equal to main's, wherever it was built", () => {
    const shell = app({ sha: SHA_OFF });
    const installedApp = {
      forkSha: undefined,
      kind: "read" as const,
      shellDiffers: false,
      stamp: stamp({ sha: SHA_OFF }),
    };
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T16:00:00Z", number: 4 }),
        running: running({ over: { installedApp }, page: SHA_A, shell }),
      }),
    ).toEqual({ kind: "in-app" });
  });

  it("is not known when an app fix sits on a page that carries it but the app's build is off the window", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T16:00:00Z", number: 4 }),
        running: running({ page: SHA_A, shell: app({ sha: SHA_OFF }) }),
      }),
    ).toEqual({ kind: "unknown", why: "the app's build is not in origin/main's recent history" });
  });

  it("is not known while the app has not said which build it runs", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T16:00:00Z", number: 4 }),
        running: running({ page: SHA_A, shell: { kind: "pending" } }),
      }),
    ).toEqual({ kind: "unknown", why: "the app has not said which build it runs yet" });
  });

  it("is waiting when the fix merged after the reading last fetched main, so no build it places carries it", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T16:30:00Z", number: 5 }),
        running: running({ page: SHA_A, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "awaiting-update" });
  });

  it("is in the app when the fix is older than the whole window and both builds sit inside it", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-09T09:00:00Z", number: 0 }),
        running: running({ page: SHA_D, shell: app({ sha: SHA_D }) }),
      }),
    ).toEqual({ kind: "in-app" });
  });

  it("is not known when the page's own build is outside the window — it may be older than the fix", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-09T09:00:00Z", number: 0 }),
        running: running({ page: SHA_OFF, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "unknown", why: "this page's build is not in origin/main's recent history" });
  });

  it("is not known when the page carries no build id, or the console is a dev server", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T15:00:00Z", number: 3 }),
        running: running({ page: undefined, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "unknown", why: "this page's build carries no commit id" });
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T15:00:00Z", number: 3 }),
        running: running({
          over: { served: { kind: "dev", live: true, startedIso: "2026-10-10T16:00:00Z" } },
          page: SHA_A,
          shell: { kind: "browser" },
        }),
      }),
    ).toEqual({ kind: "unknown", why: "the console is a dev server, so which commit it carries is not fixed" });
  });

  it("is not known when an older fix's pull request is missing from a window that is not cut", () => {
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-09T09:00:00Z", number: 9 }),
        running: running({
          over: { mainline: { commits: MAINLINE, limit: 50, truncated: false } },
          page: SHA_A,
          shell: { kind: "browser" },
        }),
      }),
    ).toEqual({ kind: "unknown", why: "#9 is not in origin/main's recent history as last read" });
  });

  it("is elsewhere for a fix landed in another repository, even one older than the window", () => {
    expect(
      steerInApp({
        landing: {
          mergedIso: "2026-09-28T10:18:54Z",
          number: 17_237,
          url: "https://github.com/acme/acme-admin/pull/17237",
        },
        running: running({ page: SHA_A, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "elsewhere" });
  });

  it("is elsewhere for another repository's pull request whose number collides with one on the window", () => {
    expect(
      steerInApp({
        landing: {
          mergedIso: "2026-10-10T15:00:00Z",
          number: 3,
          url: "https://github.com/acme/acme-admin/pull/3",
        },
        running: running({ page: SHA_A, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "elsewhere" });
  });

  it("joins the console's own repository whatever case each reader spells it in", () => {
    expect(
      steerInApp({
        landing: {
          mergedIso: "2026-10-10T15:00:00Z",
          number: 3,
          url: "https://github.com/LachieJames/Slopweaver/pull/3",
        },
        running: running({ page: SHA_C, shell: { kind: "browser" } }),
      }),
    ).toEqual({ kind: "awaiting-update" });
  });

  it("is not known when the reading's window links no pull request to a repository", () => {
    const unlinked = MAINLINE.map((each) => ({
      ...each,
      pullRequest: { number: each.pullRequest!.number, url: undefined },
    }));
    expect(
      steerInApp({
        landing: landed({ mergedIso: "2026-10-10T15:00:00Z", number: 3 }),
        running: running({
          over: { mainline: { commits: unlinked, limit: 4, truncated: true } },
          page: SHA_A,
          shell: { kind: "browser" },
        }),
      }),
    ).toEqual({ kind: "unknown", why: "the build reading names no repository for its pull requests" });
  });
});
