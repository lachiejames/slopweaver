/**
 * `slopweaver machine dispatches` — the read half and the settle half, over a real throwaway register.
 *
 * `settle` is the ONLY way a row stops being open, which is what makes a dispatch an obligation rather than
 * a log line, so the cases that matter are the ones that refuse: an unknown id, an already-settled row, and
 * a settlement carrying no witness.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMachineDispatchesWithDeps } from "../../../../../cli/commands/machine/dispatches.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";
import { unwrap } from "../../../../../lib/result.js";
import type { DispatchRow } from "../../../../../live/machine/dispatchRow.js";
import {
  appendDispatchRow,
  dispatchRegisterPath,
  readDispatchRows,
} from "../../../../../live/machine/dispatchStore.js";

const NOW = "2026-09-19T09:40:00.000Z";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    out,
  };
}

/** One row, with only what a case varies overridden. */
function row(over: Partial<DispatchRow> = {}): DispatchRow {
  return {
    id: "d1",
    load1: 45.9,
    observedIso: "2026-09-19T09:00:00.000Z",
    seated: { kind: "seated", slug: "machine-load-bfs-d1", workspace: "machine-load-bfs-d1" },
    settled: undefined,
    signature: "hold+single-process|bfs|foreign",
    subject: {
      kill: "kill 4242",
      label: "bfs",
      sessionId: undefined,
      tree: [{ cpuPct: 301.2, elapsedSeconds: 900, label: "bfs", pid: 4242 }],
      why: "bfs (pid 4242) at 301.2% cpu for 15m — foreign, no session owns it",
    },
    triggers: ["hold", "single-process"],
    ...over,
  };
}

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "machine-dispatches-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** `slopweaver machine dispatches <tail>` — the tail starts at argv index 4. */
function run({ tail, log }: { tail: readonly string[]; log: Pick<Logger, "error" | "out"> }): number {
  return runMachineDispatchesWithDeps({
    argv: ["node", "slopweaver", "machine", "dispatches", ...tail],
    deps: { now: () => NOW },
    log,
  });
}

describe("runMachineDispatchesWithDeps", () => {
  it("prints usage on --help", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]!).toContain("usage: slopweaver machine dispatches");
  });

  it("exits 3 on an empty register — a legitimate status, not a fault", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(out[0]!).toContain("no open rows in");
  });

  it("prints an open row and its culprit tree beneath it", () => {
    appendDispatchRow({ home, row: row() });
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]!).toContain("d1  2026-09-19T09:00:00.000Z  OPEN  [hold+single-process] bfs");
    expect(out[1]!).toBe("     301.2%  bfs (pid 4242)");
  });

  it("hides a settled row by default and shows it under --all", () => {
    appendDispatchRow({ home, row: row({ settled: { atIso: NOW, witness: "killed it" } }) });
    const hidden = captureLogger();
    const shown = captureLogger();

    expect(run({ log: hidden.log, tail: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run({ log: shown.log, tail: ["--home", home, "--all"] })).toBe(EXIT_OK);
    expect(shown.out[0]!).toContain(`settled ${NOW}`);
  });

  it("emits the register path beside the rows under --json", () => {
    appendDispatchRow({ home, row: row() });
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--home", home, "--json"] })).toBe(EXIT_OK);

    const document = JSON.parse(out[0]!) as { register: string; rows: { id: string }[] };

    expect(document.register).toContain("dispatches.jsonl");
    expect(document.rows.map((entry) => entry.id)).toStrictEqual(["d1"]);
  });

  it("exits 3 under --json with nothing to show, so `verb || alert` still fires", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--home", home, "--json"] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(JSON.parse(out[0]!)).toMatchObject({ rows: [] });
  });

  it("settles a row by appending the same id with the witness", () => {
    appendDispatchRow({ home, row: row() });
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["settle", "d1", "--home", home, "--witness", "killed the bfs; load back to 3.1"] })).toBe(
      EXIT_OK,
    );
    expect(out[0]!).toBe("machine dispatches: settled d1 — killed the bfs; load back to 3.1");

    const rows = unwrap(readDispatchRows({ home }));

    expect(rows[0]!.settled).toStrictEqual({ atIso: NOW, witness: "killed the bfs; load back to 3.1" });
  });

  it("refuses to settle an id no row carries, and says how to list them", () => {
    const { errs, log } = captureLogger();

    expect(run({ log, tail: ["settle", "d9", "--home", home, "--witness", "gone"] })).toBe(EXIT_USAGE);
    expect(errs[0]!).toBe("machine dispatches: no row carries the id d9 — `slopweaver machine dispatches --all`");
  });

  it("refuses to settle a row twice, naming the settlement already on it", () => {
    appendDispatchRow({ home, row: row({ settled: { atIso: "2026-09-19T09:20:00.000Z", witness: "reaped" } }) });
    const { errs, log } = captureLogger();

    expect(run({ log, tail: ["settle", "d1", "--home", home, "--witness", "again"] })).toBe(EXIT_USAGE);
    expect(errs[0]!).toBe("machine dispatches: d1 was already settled at 2026-09-19T09:20:00.000Z — reaped");
  });

  it("refuses a settlement carrying no witness — a silent close is what the register exists to prevent", () => {
    appendDispatchRow({ home, row: row() });
    const { errs, log } = captureLogger();

    expect(run({ log, tail: ["settle", "d1", "--home", home] })).toBe(EXIT_USAGE);
    expect(errs[0]!).toBe("machine dispatches: `settle` needs an id and a --witness naming what you observed");
  });

  it("refuses a whitespace-only witness for the same reason", () => {
    appendDispatchRow({ home, row: row() });
    const { errs, log } = captureLogger();

    expect(run({ log, tail: ["settle", "d1", "--home", home, "--witness", "   "] })).toBe(EXIT_USAGE);
    expect(errs[0]!).toContain("needs an id and a --witness");
  });

  it("reports an unreadable register rather than reading it as empty", () => {
    mkdirSync(dispatchRegisterPath({ home }), { recursive: true });
    const { errs, log } = captureLogger();

    expect(run({ log, tail: ["--home", home] })).toBe(EXIT_ERROR);
    expect(errs[0]!).toContain("machine dispatches: could not read the dispatch register at");
  });
});
