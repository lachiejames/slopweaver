/*
 * The effectful half the `github stack adopt --register-only` test files share. Each case mints a throwaway home,
 * removed after every case by the `afterEach` that `useTempHomes()` registers, and `harness()` writes the REAL
 * stack ledger into that explicit home. Every replay-only Git read is wired to THROW here, so a register-only
 * dispatch that happened after `localAdoptFacts` or the effective-commit measurement fails its case rather than
 * passing quietly — the defect most likely to leave this mode landed and still deadlocked.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { GithubStackAdoptDeps } from "../../../../../../cli/commands/github/stackAdoptRun.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { registerStackMember } from "../../../../../../outbound/github/stackLedger.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { MAIN_SHA } from "./fixtures.js";

const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useTempHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * Mint a fresh state home for one case, recorded for removal after it.
 *
 * @returns the new directory's absolute path
 */
export function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "stack-adopt-register-home-"));
  fixtureDirs.push(home);
  return home;
}

/** What one run observed: its printed lines, every Git command it ran, and every native stack call. */
interface Observed {
  readonly deps: GithubStackAdoptDeps;
  readonly door: MemoryDoorLedger;
  readonly lines: string[];
  readonly reads: string[];
  readonly writes: (readonly string[])[];
  readonly calls: string[];
}

/**
 * The three replay-only Git reads, wired to throw.
 *
 * `symbolic-ref` and `status --porcelain` are `localAdoptFacts`'s, `rev-parse HEAD` is its local-HEAD read,
 * and `rev-list --cherry-pick` is the effective-commit measurement. Any of them firing means the register-only
 * dispatch happened too late.
 */
const REPLAY_ONLY_READS: readonly string[] = ["symbolic-ref", "status", "rev-parse HEAD", "rev-list"];

/**
 * The adopt verb's edges over `api`: Git reads answered for the repository and its default branch only, every
 * Git write refused, and the real ledger write behind `registerMember`.
 *
 * @param ledgerThrows make the local enrolment throw, as a ledger directory that is a file would
 * @returns the deps, plus everything the run printed, read, wrote and called
 */
export function harness({ api, ledgerThrows = false }: { api: GithubWriteApi; ledgerThrows?: boolean }): Observed {
  const lines: string[] = [];
  const reads: string[] = [];
  const writes: (readonly string[])[] = [];
  const calls: string[] = [];
  const readGit = ({ args }: { args: readonly string[] }): string => {
    const command = args.join(" ");
    reads.push(command);
    if (REPLAY_ONLY_READS.some((forbidden) => command.startsWith(forbidden))) {
      throw new Error(`replay-only Git read reached in register-only mode: ${command}`);
    }
    if (command === "rev-parse --show-toplevel") return "/repo";
    if (command === "remote get-url origin") return "git@example.test:o/r.git";
    if (command === "ls-remote --symref origin HEAD") return `ref: refs/heads/main\tHEAD\n${MAIN_SHA}\tHEAD`;
    throw new Error(`unexpected Git read: ${command}`);
  };
  const door = memoryDoorLedger();
  const deps: GithubStackAdoptDeps = {
    env: () => undefined,
    git: {
      cwd: () => "/repo",
      doorLedger: door.port,
      out: ({ line }) => lines.push(line),
      readGit,
      writeGit: ({ args }) => {
        writes.push(args);
        throw new Error(`no Git write belongs in register-only mode: ${args.join(" ")}`);
      },
    },
    makeApi: () => api,
    now: () => new Date("2026-09-12T00:00:00Z"),
    out: ({ line }) => lines.push(line),
    registerMember: (input) => {
      calls.push(`ledger ${input.owner}/${input.repo}#${String(input.number)} via ${input.via}`);
      if (ledgerThrows) {
        throw new Error("EACCES: the ledger directory is a file");
      }
      // The REAL ledger write against an explicit temporary home — a plain injected seam, not a mock, so the
      // round trip `isRegisteredStackMember` reads back is the shipped one.
      registerStackMember(input);
    },
    token: () => "fake-test-token",
  };
  return { calls, deps, door, lines, reads, writes };
}
