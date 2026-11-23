/**
 * The keep-alive session's own tree measurement and its record reconciliation, driven through injected
 * seams and a real record file.
 *
 * Three properties are asserted here rather than left to the shape of the code, because each was WRONG in
 * an earlier pass and none was visible from a unit test that only checked the happy path: the loop is graded
 * against its own sensitivity list, it never grows a `plugin-dir` tree it does not read, and a record naming
 * a dead run is not the answer while another watch is running.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WATCH_SESSION_FILE } from "../../../../../claude/watchSession.js";
import { keepAliveFreshness, mainCheckoutWords } from "../../../../../cli/commands/session/standingFreshness.js";
import {
  type ProcessSnapshot,
  type StandingInspectDeps,
  sameCheckoutOnDisk,
} from "../../../../../live/standing/inspect.js";
import type { ClaudeWatchProcess, ProcessRow } from "../../../../../live/standing/processes.js";
import { keepAliveLiveness } from "../../../../../live/standing/sessionLiveness.js";

const WATCH_TREE = "/wt/keep-alive";
const NOW_ISO = "2026-09-10T12:00:00.000Z";

/** A git seam answering per tree from a table keyed on the command. */
function deps({
  answers,
}: {
  answers: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): StandingInspectDeps {
  return { git: ({ args, cwd }) => answers[cwd]?.[args.join(" ")], processes: () => [] };
}

/** The answers a tree gives when `origin/main` carries `behind` commits touching `changed`. */
function behindBy({ behind, changed }: { behind: number; changed: string }): Record<string, string> {
  return {
    "diff --name-only HEAD...origin/main": changed,
    "fetch --quiet origin": "",
    "rev-list --count HEAD..origin/main": String(behind),
    "rev-parse --git-common-dir": "/repo/.git",
    "rev-parse --short HEAD": "abc1234",
  };
}

/** One running watch, decoded. */
function candidate({ cwd = WATCH_TREE, pid = 4242 }: { cwd?: string; pid?: number } = {}): ClaudeWatchProcess {
  return { cwd, pid, ppid: 1, waiting: false };
}

describe("keepAliveFreshness — graded against the code this session actually runs", () => {
  it("grades a change under src/claude STALE, which the loop chain's list would have called merely behind", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate()],
      deps: deps({ answers: { [WATCH_TREE]: behindBy({ behind: 3, changed: "src/claude/watchTick.ts" }) } }),
    });
    expect(measured.freshness!.grade).toBe("stale");
    expect(measured.freshness!.session).toBe("keep-alive");
    expect(measured.freshness!.trees[0]!.touched).toStrictEqual(["src/claude/watchTick.ts"]);
  });

  it("grades a change to the verb shell STALE too", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate()],
      deps: deps({ answers: { [WATCH_TREE]: behindBy({ behind: 1, changed: "src/cli/commands/claude/watch.ts" }) } }),
    });
    expect(measured.freshness!.grade).toBe("stale");
  });

  // The complement, and the reason the list is its own: a Slack-loop path is NOT this session's code, so
  // it is drift to report rather than an alert to raise.
  it("grades a change under the Slack loop's own paths as merely behind", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate()],
      deps: deps({
        answers: {
          [WATCH_TREE]: behindBy({ behind: 4, changed: "skills/loop/SKILL.md\nsrc/outbound/slack/render.ts" }),
        },
      }),
    });
    expect(measured.freshness!.grade).toBe("behind");
    expect(measured.freshness!.trees[0]!.touched).toStrictEqual([]);
  });

  // A keep-alive started inside a Claude Code session inherits that session's `--plugin-dir`, and walking up
  // to it once graded a tree the loop does not read (measured). Freshness now measures exactly the
  // checkout each running watch's own argv names, and nothing else.
  it("measures only bin, one tree per running watch's checkout", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate()],
      deps: deps({ answers: { [WATCH_TREE]: behindBy({ behind: 0, changed: "" }) } }),
    });
    expect(measured.freshness!.grade).toBe("current");
    expect(measured.freshness!.trees.map((tree) => [tree.role, tree.path])).toStrictEqual([["bin", WATCH_TREE]]);
  });
});

describe("keepAliveFreshness — every running watch is measured", () => {
  // A duplicate on a stale tree is still rotating credentials with stale code, so the record's own watch
  // being current must not hide it.
  it("folds distinct checkouts to the WORST grade, each measured in first-seen order", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate(), candidate({ cwd: "/wt/stale", pid: 5151 })],
      deps: deps({
        answers: {
          "/wt/stale": behindBy({ behind: 9, changed: "src/claude/keepAlive.ts" }),
          [WATCH_TREE]: behindBy({ behind: 0, changed: "" }),
        },
      }),
    });
    expect(measured.freshness!.grade).toBe("stale");
    expect(measured.freshness!.trees.map((tree) => [tree.path, tree.grade])).toStrictEqual([
      [WATCH_TREE, "current"],
      ["/wt/stale", "stale"],
    ]);
  });

  it("measures one checkout once, however many watches run out of it", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate(), candidate({ pid: 5151 })],
      deps: deps({ answers: { [WATCH_TREE]: behindBy({ behind: 0, changed: "" }) } }),
    });
    expect(measured.freshness!.trees).toHaveLength(1);
  });

  it("reports a problem and grades nothing when no watch is running — a dead record names no tree", () => {
    const measured = keepAliveFreshness({ candidates: [], deps: deps({ answers: {} }) });
    expect(measured.freshness).toBe(undefined);
    expect(measured.problems).toStrictEqual([
      "keep-alive freshness: nothing to measure — no `claude watch` is running, so there is no checkout whose " +
        "commit could be graded",
    ]);
  });
});

describe("keepAliveLiveness — the record, reconciled against one snapshot", () => {
  let home = "";
  const EMPTY: ProcessSnapshot = { kind: "rows", rows: [] };

  /** A running watch's node child out of {@link WATCH_TREE}. */
  function watchRow({ pid }: { pid: number }): ProcessRow {
    return { argv: `node ${WATCH_TREE}/bin/../src/cli/index.ts claude watch --interval 5`, pid, ppid: 1 };
  }

  function writeRecord({ pid }: { pid: number }): void {
    writeFileSync(
      join(home, WATCH_SESSION_FILE),
      JSON.stringify({
        cwd: WATCH_TREE,
        intervalMs: 300_000,
        lastTickStartedAtIso: NOW_ISO,
        pid,
        startedAtIso: NOW_ISO,
        watchId: "w1a2b3c4",
      }),
    );
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "keepalive-"));
    mkdirSync(join(home, "claude-accounts"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("grades a home with no record and no running watch as never-started", () => {
    const read = keepAliveLiveness({ home, nowMs: Date.parse(NOW_ISO), snapshot: EMPTY });
    expect(read.liveness.state).toBe("never-started");
    expect(read.live).toBe(false);
  });

  it("grades a record whose own process is running as watching, through a real file", () => {
    writeRecord({ pid: 4242 });
    const read = keepAliveLiveness({
      home,
      nowMs: Date.parse(NOW_ISO) + 1000,
      snapshot: { kind: "rows", rows: [watchRow({ pid: 4242 })] },
    });
    expect(read.liveness.state).toBe("watching");
    expect(read.live).toBe(true);
    expect(read.watchId).toBe("w1a2b3c4");
  });

  // MEASURED, the incident this reconciliation closes: the record named a watch that had
  // been killed while the first watch still ticked, and the gauge said "keep-alive: NOT running".
  it("reads a dead recorded run beside a running watch as LIVE, not as NOT running", () => {
    writeRecord({ pid: 4242 });
    const read = keepAliveLiveness({
      home,
      nowMs: Date.parse(NOW_ISO),
      snapshot: { kind: "rows", rows: [watchRow({ pid: 5151 })] },
    });
    expect(read.liveness.state).toBe("unrecorded");
    expect(read.live).toBe(true);
  });

  // The reason this is a filesystem round trip rather than another pure case: `readJsonFile` is the
  // TOLERANT read and collapses "missing" and "unparseable" into one `undefined`, so every purely-injected
  // test of the `invalid` verdict passed while the verdict was UNREACHABLE through the only path that runs
  // in production. A truncated record read as never-started sends an operator to start a loop instead of
  // to the file.
  it("grades a TRUNCATED record invalid, which the tolerant JSON read alone would call never-started", () => {
    writeFileSync(join(home, WATCH_SESSION_FILE), "{");
    const read = keepAliveLiveness({ home, nowMs: Date.parse(NOW_ISO), snapshot: EMPTY });
    expect(read.liveness.state).toBe("invalid");
    expect(read.live).toBe(false);
  });

  it("grades an empty record file invalid too", () => {
    writeFileSync(join(home, WATCH_SESSION_FILE), "");
    expect(keepAliveLiveness({ home, nowMs: Date.parse(NOW_ISO), snapshot: EMPTY }).liveness.state).toBe("invalid");
  });

  // Valid JSON that is not a record. The file exists and decodes, so an existence check alone waves it
  // through — it has to be the PARSER that refuses a non-record, not the read.
  it("grades a record file holding literal null invalid, not never-started", () => {
    writeFileSync(join(home, WATCH_SESSION_FILE), "null");
    expect(keepAliveLiveness({ home, nowMs: Date.parse(NOW_ISO), snapshot: EMPTY }).liveness.state).toBe("invalid");
  });

  it("grades a record file holding a bare array invalid too", () => {
    writeFileSync(join(home, WATCH_SESSION_FILE), "[]");
    expect(keepAliveLiveness({ home, nowMs: Date.parse(NOW_ISO), snapshot: EMPTY }).liveness.state).toBe("invalid");
  });

  // The untraversable-parent case — a `chmod 000` on the record's directory, which fails BOTH the read
  // and an `existsSync` closed — is what drove the code to read the error CODE instead of pairing a
  // tolerant read with an existence check. It is deliberately NOT tested here. MEASURED: a test that
  // chmods a directory inside the per-file temp sandbox reddened unrelated files — `src/__tests__/unit/
  // atlas/**` passed 540/540 alone and failed 2 when run alongside it — so the test damaged the run it
  // was part of. A case that can only be exercised by breaking the sandbox is not worth a flaky lane;
  // the error-code branch it drove is simple and its sibling cases below cover the same verdict.
  it("grades a record that decodes but fails a field check invalid, naming the field", () => {
    writeFileSync(join(home, WATCH_SESSION_FILE), JSON.stringify({ cwd: WATCH_TREE, pid: 0 }));
    const read = keepAliveLiveness({ home, nowMs: Date.parse(NOW_ISO), snapshot: EMPTY });
    expect(read.liveness.state).toBe("invalid");
  });
});

describe("keepAliveFreshness — one checkout, however its argv spells it", () => {
  // The owner match normalised paths while freshness deduplicated spellings, so
  // `/repo` and `/repo/.` were one checkout to the verdict and two measured trees here.
  it("measures two spellings of the same checkout once, under the first-seen spelling", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate(), candidate({ cwd: `${WATCH_TREE}/.`, pid: 5151 })],
      deps: deps({ answers: { [WATCH_TREE]: behindBy({ behind: 0, changed: "" }) } }),
    });
    expect(measured.freshness!.trees.map((tree) => tree.path)).toStrictEqual([WATCH_TREE]);
  });
});

describe("keepAliveFreshness — one checkout, however the filesystem aliases it", () => {
  // On macOS `/var/…` and `/private/var/…` are one checkout, which no lexical
  // comparison can see. Git names the physical top level, so two aliases git resolves alike are measured once.
  it("measures two aliases of one checkout once, when git resolves both to the same top level", () => {
    const top = { "rev-parse --show-toplevel": "/private/var/repo" };
    const measured = keepAliveFreshness({
      candidates: [candidate({ cwd: "/var/repo" }), candidate({ cwd: "/private/var/repo", pid: 5151 })],
      deps: deps({
        answers: {
          "/private/var/repo": { ...behindBy({ behind: 0, changed: "" }), ...top },
          "/var/repo": { ...behindBy({ behind: 0, changed: "" }), ...top },
        },
      }),
    });
    expect(measured.freshness!.trees.map((tree) => tree.path)).toStrictEqual(["/var/repo"]);
  });
});

describe("keepAliveFreshness — an alias is one checkout even when git cannot answer", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "keepalive-alias-"));
    mkdirSync(join(root, "tree"));
    symlinkSync(join(root, "tree"), join(root, "alias"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  // With git's identity read failing (a timeout, say), the fallback was lexical, so
  // `/var/…` and `/private/var/…` were measured twice. The fallback is now the filesystem's own real path.
  it("measures a symlinked alias and its target once when git names neither", () => {
    const measured = keepAliveFreshness({
      candidates: [candidate({ cwd: join(root, "tree") }), candidate({ cwd: join(root, "alias"), pid: 5151 })],
      deps: deps({ answers: {} }),
    });
    expect(measured.freshness!.trees.map((tree) => tree.path)).toStrictEqual([join(root, "tree")]);
  });
});

describe("sameCheckoutOnDisk — the comparator the gauge and admission actually run", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "keepalive-same-"));
    mkdirSync(join(root, "tree"));
    mkdirSync(join(root, "other"));
    symlinkSync(join(root, "tree"), join(root, "alias"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("treats a symlinked alias and its target as one checkout", () => {
    expect(sameCheckoutOnDisk({ left: join(root, "alias"), right: join(root, "tree") })).toBe(true);
  });

  it("keeps two real checkouts apart", () => {
    expect(sameCheckoutOnDisk({ left: join(root, "other"), right: join(root, "tree") })).toBe(false);
  });

  it("falls back to the normalised spelling for a path that does not exist", () => {
    expect(sameCheckoutOnDisk({ left: "/no/such/tree/bin/..", right: "/no/such/tree" })).toBe(true);
  });
});

describe("mainCheckoutWords — the supervisor's main checkout as `session standing` prints it", () => {
  it("names the declared main checkout", () => {
    expect(mainCheckoutWords({ supervisor: { binPath: "/repo/main" } })).toBe("/repo/main");
  });

  it("says UNRESOLVED when no declared main checkout resolved", () => {
    expect(mainCheckoutWords({ supervisor: { binPath: undefined } })).toBe("UNRESOLVED");
  });
});
