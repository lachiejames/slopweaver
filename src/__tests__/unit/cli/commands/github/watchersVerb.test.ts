/**
 * `github watchers` end to end over injected seams: the register read is a plain fake, the clock is pinned,
 * and the round trip writes into a throwaway home through the real append.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GITHUB_WATCHERS_FLAG_NAMES, renderWatchers } from "../../../../../cli/commands/github/watchersCore.js";
import {
  type GithubWatchersDeps,
  productionGithubWatchersDeps,
  runGithubWatchers,
} from "../../../../../cli/commands/github/watchersRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import {
  appendChecksReadRecord,
  ChecksReadErrors,
  type ChecksReadRow,
} from "../../../../../outbound/github/checksReadLedger.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway state home with its `ledgers/` directory already there. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-watchers-"));
  mkdirSync(join(dir, "ledgers"), { recursive: true });
  cleanups.push(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return dir;
}

const NOW = "2026-09-20T04:04:00.000Z";

const ROWS: readonly ChecksReadRow[] = [
  {
    atIso: "2026-09-20T04:00:00.000Z",
    headSha: "aaaaaaaaaaaa",
    kind: "read",
    number: 973,
    repo: "o/r",
    rollup: "PENDING",
  },
  {
    atIso: "2026-09-20T04:00:00.000Z",
    headSha: "aaaaaaaaaaaa",
    kind: "watching",
    mode: "wait",
    number: 973,
    repo: "o/r",
    session: "sess-a",
    timeoutSeconds: 600,
  },
  {
    atIso: "2026-09-20T04:01:00.000Z",
    headSha: "bbbbbbbbbbbb",
    kind: "read",
    number: 5,
    repo: "o/other",
    rollup: "SUCCESS",
  },
];

/** What one run wrote to each channel, and what it exited with. */
function run({
  rest,
  rows = ROWS,
  readFails = false,
}: {
  rest: readonly string[];
  rows?: readonly ChecksReadRow[];
  readFails?: boolean;
}): { exit: number; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: GithubWatchersDeps = {
    now: () => NOW,
    readLedger: () => {
      if (readFails) {
        return err(ChecksReadErrors.unreadable({ path: "/nowhere/pr-checks-read.jsonl", cause: "EACCES" }));
      }
      return ok(rows);
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: runGithubWatchers({ deps, rest }), out };
}

describe("github watchers", () => {
  it("prints one line per pull request the register names, watchers then the last read", () => {
    const ran = run({ rest: [] });
    expect(ran.exit).toBe(EXIT_OK);
    expect(ran.out).toEqual([
      "o/r#973  sess-a watching (wait, since 2026-09-20T04:00:00.000Z, head aaaaaaaaaa)  ·  last read 2026-09-20T04:00:00.000Z at aaaaaaaaaa, rollup PENDING",
      "o/other#5  not watched  ·  last read 2026-09-20T04:01:00.000Z at bbbbbbbbbb, rollup SUCCESS",
    ]);
  });

  it("--json prints one object stamped with the fold's own instant", () => {
    const ran = run({ rest: ["--json"] });
    expect(ran.exit).toBe(EXIT_OK);
    expect(JSON.parse(ran.out[0]!)).toEqual({
      entries: [
        {
          lastRead: { atIso: "2026-09-20T04:00:00.000Z", headSha: "aaaaaaaaaaaa", rollup: "PENDING" },
          number: 973,
          repo: "o/r",
          watchers: [
            {
              headSha: "aaaaaaaaaaaa",
              mode: "wait",
              session: "sess-a",
              sinceIso: "2026-09-20T04:00:00.000Z",
              stale: false,
            },
          ],
        },
        {
          lastRead: { atIso: "2026-09-20T04:01:00.000Z", headSha: "bbbbbbbbbbbb", rollup: "SUCCESS" },
          number: 5,
          repo: "o/other",
          watchers: [],
        },
      ],
      observedAtIso: NOW,
    });
  });

  it("--repo narrows to one repository", () => {
    const ran = run({ rest: ["--repo", "o/other"] });
    expect(ran.out).toEqual([
      "o/other#5  not watched  ·  last read 2026-09-20T04:01:00.000Z at bbbbbbbbbb, rollup SUCCESS",
    ]);
  });

  it("says the register names nothing rather than printing an empty list", () => {
    const ran = run({ rest: [], rows: [] });
    expect(ran.exit).toBe(EXIT_OK);
    expect(ran.out).toEqual([
      "github watchers: the register names no pull request yet — nothing has been read or watched",
    ]);
  });

  it("an unreadable register is an error, never nobody watching", () => {
    const ran = run({ readFails: true, rest: ["--json"] });
    expect(ran.exit).toBe(EXIT_ERROR);
    expect(ran.out).toEqual([]);
    expect(ran.diagnostics[0]).toContain("github watchers: ");
    expect(ran.diagnostics[0]).toContain("/nowhere/pr-checks-read.jsonl");
  });

  it("refuses an unknown flag as a usage mistake", () => {
    const ran = run({ rest: ["--wat"] });
    expect(ran.exit).toBe(EXIT_USAGE);
    expect(ran.diagnostics[0]).toContain("--wat");
  });

  it("names a STALE watcher in the human line", () => {
    const stale: ChecksReadRow[] = [{ ...ROWS[1]!, timeoutSeconds: 60 } as ChecksReadRow];
    const ran = run({ rest: [], rows: stale });
    expect(ran.out).toEqual([
      "o/r#973  sess-a STALE (wait, since 2026-09-20T04:00:00.000Z, head aaaaaaaaaa)  ·  never read",
    ]);
  });

  it("reads the real register through the production seam when given a home", () => {
    const dir = home();
    const row = ROWS[1]!;
    expect(appendChecksReadRecord({ home: dir, nowIso: row.atIso, row }).isOk()).toBe(true);
    const out: string[] = [];
    const deps: GithubWatchersDeps = {
      ...productionGithubWatchersDeps(),
      now: () => NOW,
      writeOut: (line) => out.push(line),
    };
    expect(runGithubWatchers({ deps, rest: ["--home", dir, "--json"] })).toBe(EXIT_OK);
    const parsed = JSON.parse(out[0]!) as { entries: { number: number; watchers: { session: string }[] }[] };
    expect(parsed.entries.map((entry) => entry.number)).toEqual([973]);
    expect(parsed.entries[0]!.watchers.map((watcher) => watcher.session)).toEqual(["sess-a"]);
  });
});

describe("the flag list the help-truth ratchet reads", () => {
  it("is sorted and complete", () => {
    expect(GITHUB_WATCHERS_FLAG_NAMES).toEqual(["--home", "--json", "--repo"]);
  });
});

describe("renderWatchers", () => {
  it("renders an entry that was watched and never read", () => {
    expect(
      renderWatchers({
        entries: [
          {
            lastRead: undefined,
            number: 1,
            repo: "o/r",
            watchers: [
              {
                headSha: "cccccccccccc",
                mode: "merge",
                session: "s",
                sinceIso: "2026-09-20T04:00:00.000Z",
                stale: false,
              },
            ],
          },
        ],
      }),
    ).toEqual(["o/r#1  s watching (merge, since 2026-09-20T04:00:00.000Z, head cccccccccc)  ·  never read"]);
  });
});
