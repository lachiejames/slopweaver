import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SocketPathSources } from "../../../cmux/socketPath.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type PruneTriggerError, PruneTriggerErrors } from "../../../worktree/pruneTriggerDetach.js";
import {
  type PruneTriggerDeps,
  productionPruneTriggerDeps,
  requestWorktreePrune,
} from "../../../worktree/pruneTriggerLaunch.js";

const NOW_MS = Date.parse("2026-10-11T22:51:50.000Z");

/** 49 GB in `df -k` KiB — the reading the fleet held on. */
const LOW_KIB = 47_851_563;

/** 300 GB in `df -k` KiB — what the owner expects with the prune working. */
const HIGH_KIB = 292_968_750;

/** A recording fake: every effect appends to `calls`, and each answer is the one the case sets. */
function fakeDeps({
  calls,
  claimAnswer = ok(true),
  exists = false,
  hasCheckouts = true,
  launchAnswer = ok(undefined),
  servesLiveState = true,
}: {
  calls: string[];
  claimAnswer?: Result<boolean, PruneTriggerError>;
  exists?: boolean;
  hasCheckouts?: boolean;
  launchAnswer?: Result<void, PruneTriggerError>;
  servesLiveState?: boolean;
}): PruneTriggerDeps {
  return {
    claim: ({ name }) => {
      calls.push(`claim ${name}`);
      return claimAnswer;
    },
    confirm: ({ name }) => {
      calls.push(`confirm ${name}`);
    },
    hasCheckouts: () => {
      calls.push("checkouts");
      return hasCheckouts;
    },
    launch: ({ argv }) => {
      calls.push(`launch ${argv.join(" ")}`);
      return launchAnswer;
    },
    markerExists: ({ name }) => {
      calls.push(`exists ${name}`);
      return exists;
    },
    note: ({ line }) => {
      calls.push(`note ${line}`);
    },
    nowMs: () => NOW_MS,
    release: ({ name }) => {
      calls.push(`release ${name}`);
    },
    servesLiveState: () => {
      calls.push("serves-live-state");
      return servesLiveState;
    },
  };
}

/** Socket-path sources carrying only `env`, so the capability token is the one thing a case varies. */
function socketSources({ env }: { env: Readonly<Record<string, string | undefined>> }): SocketPathSources {
  return { env, readTextFile: () => undefined, userHome: "/home/fixture" };
}

describe("requestWorktreePrune", () => {
  it("launches the prune itself on a reading under 100 GB, heading the log with the cause and the free disk", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ availableKib: LOW_KIB, cause: "threshold", deps: fakeDeps({ calls }) });
    expect(unwrap(outcome)).toBe("launched");
    expect(calls).toEqual([
      "exists threshold-2026-10-11T22-50-00Z",
      "checkouts",
      "serves-live-state",
      "claim threshold-2026-10-11T22-50-00Z",
      "note 2026-10-11T22:51:50.000Z cause=threshold free=49GB launching: worktree prune --apply --if-idle",
      "launch worktree prune --apply --if-idle",
      "confirm threshold-2026-10-11T22-50-00Z",
    ]);
  });

  it("launches on a reading above 100 GB but under a higher floor the caller passed", () => {
    const calls: string[] = [];
    // 100.4 GB free (98,046,875 KiB x 1024 B) against a caller's 100.8 GB floor.
    const outcome = requestWorktreePrune({
      availableKib: 98_046_875,
      cause: "threshold",
      deps: fakeDeps({ calls }),
      floorGb: 100.8,
    });
    expect(unwrap(outcome)).toBe("launched");
  });

  it("does not launch on a reading under 100 GB when the caller's floor is lower", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({
      availableKib: LOW_KIB,
      cause: "threshold",
      deps: fakeDeps({ calls }),
      floorGb: 40,
    });
    expect(unwrap(outcome)).toBe("not-owed");
    expect(calls).toEqual([]);
  });

  it("does nothing at all on a reading over the floor — not even a marker read", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ availableKib: HIGH_KIB, cause: "threshold", deps: fakeDeps({ calls }) });
    expect(unwrap(outcome)).toBe("not-owed");
    expect(calls).toEqual([]);
  });

  it("does nothing on an unread disk", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ availableKib: undefined, cause: "threshold", deps: fakeDeps({ calls }) });
    expect(unwrap(outcome)).toBe("not-owed");
    expect(calls).toEqual([]);
  });

  it("launches the hourly row's firing on the schedule cause, whatever the disk", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls }) });
    expect(unwrap(outcome)).toBe("launched");
    expect(calls).toEqual([
      "exists schedule-2026-10-11T22-00-00Z",
      "checkouts",
      "serves-live-state",
      "claim schedule-2026-10-11T22-00-00Z",
      "note 2026-10-11T22:51:50.000Z cause=schedule launching: automation run-due --recipe worktree-prune",
      "launch automation run-due --recipe worktree-prune",
      "confirm schedule-2026-10-11T22-00-00Z",
    ]);
  });

  it("stops at the marker read once this window has launched — the whole cost of every later hook call", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls, exists: true }) });
    expect(unwrap(outcome)).toBe("claimed-elsewhere");
    expect(calls).toEqual(["exists schedule-2026-10-11T22-00-00Z"]);
  });

  it("writes nothing for a home that declares no main checkout", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls, hasCheckouts: false }) });
    expect(unwrap(outcome)).toBe("not-owed");
    expect(calls).toEqual(["exists schedule-2026-10-11T22-00-00Z", "checkouts"]);
  });

  it("launches nothing when another caller won the claim between the read and the create", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls, claimAnswer: ok(false) }) });
    expect(unwrap(outcome)).toBe("claimed-elsewhere");
    expect(calls).toEqual([
      "exists schedule-2026-10-11T22-00-00Z",
      "checkouts",
      "serves-live-state",
      "claim schedule-2026-10-11T22-00-00Z",
    ]);
  });

  it("returns a failed claim as its error and launches nothing", () => {
    const calls: string[] = [];
    const failure = PruneTriggerErrors.markerUnwritable({ cause: new Error("EACCES"), dir: "/x" });
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls, claimAnswer: err(failure) }) });
    expect(unwrapErr(outcome).code).toBe("MARKER_UNWRITABLE");
    expect(calls).toEqual([
      "exists schedule-2026-10-11T22-00-00Z",
      "checkouts",
      "serves-live-state",
      "claim schedule-2026-10-11T22-00-00Z",
    ]);
  });

  it("leaves the hour unclaimed for a session inside cmux when this caller's child could not read the workspace list", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls, servesLiveState: false }) });
    expect(unwrap(outcome)).toBe("cannot-serve");
    expect(calls).toEqual(["exists schedule-2026-10-11T22-00-00Z", "checkouts", "serves-live-state"]);
  });

  it("leaves a low-disk window unclaimed too, rather than launching an apply that must refuse", () => {
    const calls: string[] = [];
    const outcome = requestWorktreePrune({
      availableKib: LOW_KIB,
      cause: "threshold",
      deps: fakeDeps({ calls, servesLiveState: false }),
    });
    expect(unwrap(outcome)).toBe("cannot-serve");
    expect(calls).toEqual(["exists threshold-2026-10-11T22-50-00Z", "checkouts", "serves-live-state"]);
  });

  it("returns a failed launch as its error and hands the window back for the next caller", () => {
    const calls: string[] = [];
    const failure = PruneTriggerErrors.launchFailed({ detail: "the launching shell exited 127" });
    const outcome = requestWorktreePrune({ cause: "schedule", deps: fakeDeps({ calls, launchAnswer: err(failure) }) });
    expect(unwrapErr(outcome).message).toBe(
      "the unasked worktree prune could not be started: the launching shell exited 127",
    );
    expect(calls.slice(-2)).toEqual([
      "launch automation run-due --recipe worktree-prune",
      "release schedule-2026-10-11T22-00-00Z",
    ]);
  });
});

describe("productionPruneTriggerDeps — the marker directory, round-tripped", () => {
  let home = "";

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("claims a window once, refuses the second claim, and deletes only that cause's passed windows", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "schedule-2026-10-11T20-00-00Z"), "");
    writeFileSync(join(dir, "schedule-2026-10-11T21-00-00Z"), "");
    writeFileSync(join(dir, "threshold-2026-10-11T22-50-00Z"), "");
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });

    expect(deps.markerExists({ name: "schedule-2026-10-11T22-00-00Z" })).toBe(false);
    expect(unwrap(deps.claim({ name: "schedule-2026-10-11T22-00-00Z" }))).toBe(true);
    expect(unwrap(deps.claim({ name: "schedule-2026-10-11T22-00-00Z" }))).toBe(false);
    expect(deps.markerExists({ name: "schedule-2026-10-11T22-00-00Z" })).toBe(true);
    deps.release({ name: "schedule-2026-10-11T22-00-00Z" });
    expect(deps.markerExists({ name: "schedule-2026-10-11T22-00-00Z" })).toBe(false);
    expect(unwrap(deps.claim({ name: "schedule-2026-10-11T22-00-00Z" }))).toBe(true);
    expect(readdirSync(dir).toSorted()).toEqual([
      "schedule-2026-10-11T21-00-00Z",
      "schedule-2026-10-11T22-00-00Z",
      "threshold-2026-10-11T22-50-00Z",
    ]);
  });

  it("hands a window back when its claimer died before launching, and keeps a launched one", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    mkdirSync(dir, { recursive: true });
    const abandoned = "schedule-2026-10-11T22-00-00Z";
    const launched = "threshold-2026-10-11T22-50-00Z";
    writeFileSync(join(dir, abandoned), "");
    writeFileSync(join(dir, launched), "launched");
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    utimesSync(join(dir, abandoned), twoMinutesAgo, twoMinutesAgo);
    utimesSync(join(dir, launched), twoMinutesAgo, twoMinutesAgo);
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });

    expect(deps.markerExists({ name: abandoned })).toBe(false);
    expect(deps.markerExists({ name: launched })).toBe(true);
    expect(unwrap(deps.claim({ name: abandoned }))).toBe(true);
    expect(unwrap(deps.claim({ name: launched }))).toBe(false);
    expect(deps.markerExists({ name: abandoned })).toBe(true);
    deps.confirm({ name: abandoned });
    expect(readFileSync(join(dir, abandoned), "utf8")).toBe("launched");
    expect(readdirSync(dir).toSorted()).toEqual([abandoned, launched]);
  });

  it("takes over a marker holding foreign bytes, or one it cannot read, as no claim's", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    mkdirSync(dir, { recursive: true });
    const foreign = "schedule-2026-10-11T22-00-00Z";
    const unreadable = "threshold-2026-10-11T22-50-00Z";
    writeFileSync(join(dir, foreign), "x");
    writeFileSync(join(dir, unreadable), "launched");
    chmodSync(join(dir, unreadable), 0o000);
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });

    expect(deps.markerExists({ name: foreign })).toBe(false);
    expect(deps.markerExists({ name: unreadable })).toBe(false);
    expect(unwrap(deps.claim({ name: foreign }))).toBe(true);
    expect(unwrap(deps.claim({ name: unreadable }))).toBe(true);
    expect(deps.markerExists({ name: foreign })).toBe(true);
    expect(deps.markerExists({ name: unreadable })).toBe(true);
  });

  it("reads a symlink at the marker path as no claim, takes it over, and leaves its target alone", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    mkdirSync(dir, { recursive: true });
    const target = join(home, "target");
    writeFileSync(target, "not a claim");
    const name = "schedule-2026-10-11T22-00-00Z";
    symlinkSync(target, join(dir, name));
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });

    expect(deps.markerExists({ name })).toBe(false);
    expect(unwrap(deps.claim({ name }))).toBe(true);
    deps.confirm({ name });
    expect(lstatSync(join(dir, name)).isFile()).toBe(true);
    expect(readFileSync(join(dir, name), "utf8")).toBe("launched");
    expect(readFileSync(target, "utf8")).toBe("not a claim");
  });

  it("moves aside a file standing at the trigger directory's path and claims under a fresh one", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    mkdirSync(join(dir, ".."), { recursive: true });
    writeFileSync(dir, "not a directory");
    const name = "threshold-2026-10-11T22-50-00Z";
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });

    expect(deps.markerExists({ name })).toBe(false);
    expect(unwrap(deps.claim({ name }))).toBe(true);
    expect(lstatSync(dir).isDirectory()).toBe(true);
    expect(readdirSync(dir)).toEqual([name]);
    expect(readFileSync(`${dir}.not-a-directory-${String(process.pid)}`, "utf8")).toBe("not a directory");
  });

  it("hands a window back even when the directory refuses the marker's delete", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    const name = "threshold-2026-10-11T22-50-00Z";
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });
    expect(unwrap(deps.claim({ name }))).toBe(true);
    chmodSync(dir, 0o500);
    try {
      deps.release({ name });
      expect(existsSync(join(dir, name))).toBe(true);
      expect(deps.markerExists({ name })).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(unwrap(deps.claim({ name }))).toBe(true);
  });

  it("still answers a won claim when the directory cannot be listed afterwards", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const dir = stateHomePaths({ home }).worktreePruneTriggerDir;
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o300);
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });
    try {
      expect(unwrap(deps.claim({ name: "threshold-2026-10-11T22-50-00Z" }))).toBe(true);
      expect(deps.markerExists({ name: "threshold-2026-10-11T22-50-00Z" })).toBe(true);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("serves live state exactly when the environment carries a non-blank cmux capability token", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const serves = ({ env }: { env: Readonly<Record<string, string | undefined>> }): boolean =>
      productionPruneTriggerDeps({
        home,
        importMetaUrl: import.meta.url,
        socketPathSources: socketSources({ env }),
      }).servesLiveState();

    expect(serves({ env: { CMUX_SOCKET_CAPABILITY: " v1.fixture " } })).toBe(true);
    expect(serves({ env: {} })).toBe(false);
    expect(serves({ env: { CMUX_SOCKET_CAPABILITY: "   " } })).toBe(false);
  });

  it("reads a home with no profile as declaring no checkout, and writes nothing into it", () => {
    home = mkdtempSync(join(tmpdir(), "prune-trigger-"));
    const deps = productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url });
    const outcome = requestWorktreePrune({ availableKib: LOW_KIB, cause: "threshold", deps });
    expect(unwrap(outcome)).toBe("not-owed");
    expect(existsSync(stateHomePaths({ home }).worktreeBundles)).toBe(false);
  });
});
