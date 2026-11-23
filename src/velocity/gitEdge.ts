/**
 * The effectful half of the merge-rate measurement: real `git log` calls against a real repository. Every
 * call goes through {@link gitEnv} (`../lib/gitRepo.js`), stripping `GIT_DIR`/`GIT_WORK_TREE` so `cwd`
 * decides which repository is read even when this runs under a hook — the same guarantee the merge guard
 * and every other gate in this repo already give (see `../lib/gitRepo.js`'s header for the incident).
 */
import { execFileSync } from "node:child_process";

import { absentAs } from "#lib/absent.js";
import { gitEnv } from "../lib/gitRepo.js";
import { countMergeSubjects } from "./gitVelocity.js";
import type { DayWindow } from "./windows.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The most git output this module will hold — a week of commit subjects on a busy repo, comfortably. */
const MAX_GIT_BUFFER = 16 * 1024 * 1024;

/** The refs tried, in order, when the caller does not name one. */
const CANDIDATE_REFS: readonly string[] = ["origin/main", "main", "HEAD"];

/**
 * Run one git command against `cwd`, decoded as UTF-8 text.
 *
 * @param args the git argv, never a shell string
 * @param cwd the repository to run in
 * @returns stdout
 */
function runGit({ args, cwd }: { args: readonly string[]; cwd: string }): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    maxBuffer: MAX_GIT_BUFFER,
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  });
}

/**
 * Whether `ref` resolves in `cwd`.
 *
 * @param cwd the repository to check
 * @param ref the ref to verify
 * @returns true when `git rev-parse --verify` succeeds
 */
function refExists({ cwd, ref }: { cwd: string; ref: string }): boolean {
  try {
    runGit({ args: ["rev-parse", "--verify", "--quiet", ref], cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * The base ref to measure merges against — the caller's own `ref` when given, else the first of
 * `origin/main` / `main` / `HEAD` that actually resolves in this repository.
 *
 * @param cwd the repository to resolve against
 * @param ref an explicit ref, when the caller already knows which one to use
 * @returns the ref to run `git log` against
 */
export function resolveVelocityRef({ cwd, ref }: { cwd: string; ref?: string }): string {
  if (ref !== undefined) {
    return ref;
  }
  return absentAs({
    value: CANDIDATE_REFS.find((candidate) => refExists({ cwd, ref: candidate })),
    whenAbsent: "HEAD",
  });
}

/** One day's merge count. */
export interface DayMergeCount {
  readonly dayKey: string;
  readonly merges: number;
}

/**
 * Squash-merge commits landed on `ref` in `cwd`, one count per day window.
 *
 * @param cwd the repository to read
 * @param ref the base ref (e.g. `origin/main`) to walk
 * @param windows the day windows to count within
 * @returns one {@link DayMergeCount} per window, in the same order
 */
export function mergesPerDay({
  cwd,
  ref,
  windows,
}: {
  cwd: string;
  ref: string;
  windows: readonly DayWindow[];
}): readonly DayMergeCount[] {
  return windows.map((window) => {
    const output = runGit({
      // `--end-of-options` last, so a ref that starts with a dash — `-pO<file>`, handed in by a caller — is a
      // revision git fails to find, never an option that opens a file.
      args: ["log", `--since=${window.sinceIso}`, `--until=${window.untilIso}`, "--pretty=%s", "--end-of-options", ref],
      cwd,
    });
    const subjects = output.split("\n").filter((line) => line.trim().length > 0);
    return { dayKey: window.dayKey, merges: countMergeSubjects({ subjects }) };
  });
}
