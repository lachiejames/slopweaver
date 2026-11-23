/*
 * The installed app read over plain fake seams: the bundle's answer and a map of git argument lines to stdout. The
 * same read through the whole console reader is `consoleBuildRead/installedApp.test.ts`; over real git, the subprocess lane's
 * `installedAppTopology.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { InstalledPlistRead } from "../../../checkouts/installedApp.js";
import { shellDiffArgs } from "../../../checkouts/installedApp.js";
import { readInstalledApp } from "../../../checkouts/installedAppRead.js";
import { STAMP_KEYS } from "../../../desktop/buildStamp.js";

const SHA_APP = "c".repeat(40);
const SHA_TIP = "a".repeat(40);
const SHA_FORK = "f".repeat(40);

/** An `Info.plist` carrying a stamp. */
const plist = ({ tree }: { tree: "clean" | "dirty" }): InstalledPlistRead => ({
  kind: "read",
  text: [
    `<key>${STAMP_KEYS.sha}</key><string>${SHA_APP}</string>`,
    `<key>${STAMP_KEYS.committedIso}</key><string>2026-10-08T06:48:50Z</string>`,
    `<key>${STAMP_KEYS.tree}</key><string>${tree}</string>`,
  ].join("\n"),
});

/** Read with a bundle answer and git's answers, keyed by the argument line; a line not in the map fails. */
const readWith = ({
  bundle,
  git = {},
  noUpstream = false,
}: {
  bundle: InstalledPlistRead;
  git?: Record<string, string>;
  noUpstream?: boolean;
}): { app: ReturnType<typeof readInstalledApp>; problems: string[]; asked: string[] } => {
  const problems: string[] = [];
  const asked: string[] = [];
  let upstream: { ref: string; sha: string } | undefined = { ref: "origin/main", sha: SHA_TIP };
  if (noUpstream) {
    upstream = undefined;
  }
  const app = readInstalledApp({
    deps: {
      git: ({ args }) => {
        const line = args.join(" ");
        asked.push(line);
        return git[line];
      },
      installedPlist: () => bundle,
    },
    problems,
    root: "/work",
    upstream,
  });
  return { app, asked, problems };
};

const DIFF = shellDiffArgs({ from: SHA_APP, to: SHA_TIP }).join(" ");
const STAMP = { committedIso: "2026-10-08T06:48:50Z", sha: SHA_APP, tree: "clean" };

describe("readInstalledApp", () => {
  it("reads no bundle as absent, asking git nothing and naming no problem", () => {
    const { app, asked, problems } = readWith({ bundle: { kind: "absent" } });
    expect(app).toEqual({ kind: "absent" });
    expect(asked).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("calls an unchanged app source unchanged, and never reads the fork", () => {
    const { app, asked } = readWith({ bundle: plist({ tree: "clean" }), git: { [DIFF]: "" } });
    expect(app).toEqual({ forkSha: undefined, kind: "read", shellDiffers: false, stamp: STAMP });
    expect(asked).toEqual([DIFF]);
  });

  it("names a changed app with its fork", () => {
    const git = { [DIFF]: "desktop/src/main.ts", [`merge-base ${SHA_APP} ${SHA_TIP}`]: SHA_FORK };
    const { app, problems } = readWith({ bundle: plist({ tree: "clean" }), git });
    expect(app).toEqual({ forkSha: SHA_FORK, kind: "read", shellDiffers: true, stamp: STAMP });
    expect(problems).toEqual([]);
  });

  it("names a fork it could not read as a problem, and still the changed app", () => {
    const { app, problems } = readWith({ bundle: plist({ tree: "clean" }), git: { [DIFF]: "desktop/src/main.ts" } });
    expect(app).toEqual({ forkSha: undefined, kind: "read", shellDiffers: true, stamp: STAMP });
    expect(problems).toEqual([
      "where the installed app ccccccccc forked from origin/main could not be read — which landings it lacks are not listed",
    ]);
  });

  it("compares nothing for a dirty build, and names a bundle that would not read", () => {
    const dirty = readWith({ bundle: plist({ tree: "dirty" }) });
    expect(dirty.app).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: undefined,
      stamp: { ...STAMP, tree: "dirty" },
    });
    expect(dirty.asked).toEqual([]);
    const failed = readWith({ bundle: { kind: "failed", why: "EACCES" } });
    expect(failed.app).toEqual({ kind: "unreadable", why: "the installed app's Info.plist could not be read: EACCES" });
    expect(failed.problems).toEqual(["the installed app's Info.plist could not be read: EACCES"]);
  });

  it("still reads the bundle with no upstream, comparing nothing and naming one that would not read", () => {
    const clean = readWith({ bundle: plist({ tree: "clean" }), noUpstream: true });
    expect(clean.app).toEqual({ forkSha: undefined, kind: "read", shellDiffers: undefined, stamp: STAMP });
    expect(clean.asked).toEqual([]);
    expect(clean.problems).toEqual([]);
    const failed = readWith({ bundle: { kind: "failed", why: "EACCES" }, noUpstream: true });
    expect(failed.problems).toEqual(["the installed app's Info.plist could not be read: EACCES"]);
  });
});
