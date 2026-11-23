/**
 * `slopweaver machine watch` — the between-tick watcher's shell, over injected seams and a real throwaway
 * register. The seat is a plain fake function that records what it was asked to open, so the whole verb runs
 * without a cmux workspace.
 *
 * Three properties are what this file exists to hold down, and each is a doctrine rule rather than a
 * preference: every anomalous sample WRITES a row whether or not it seats one; `--for-seconds` is clamped
 * HARD, because a watch that could outlive the tick that started it would be a resident daemon (rule 2); and
 * a dispatch exits 1 as a FINDING, so a caller cannot mistake a clear machine for a failed read.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_WATCH_SECONDS,
  type MachineWatchDeps,
  MIN_INTERVAL_SECONDS,
  runMachineWatchWithDeps,
} from "../../../../../cli/commands/machine/watch.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";
import { unwrap } from "../../../../../lib/result.js";
import type { DispatchRow, DispatchSeat } from "../../../../../live/machine/dispatchRow.js";
import {
  appendDispatchRow,
  dispatchRegisterPath,
  liveDispatchSignatures,
  readDispatchRows,
} from "../../../../../live/machine/dispatchStore.js";
import type { MachineCapacityDeps } from "../../../../../live/machine/read.js";

/** This device's own core count, which sizes the load hold at `floor(1.5 x 15)` = 22. */
const CPU_COUNT = 15;

const CLEAR_TOP_TEXT = "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n100    500M \n";
/** A heavy-load reading: load 45.9, well past this device's hold of 22. */
const HOLDING_TOP_TEXT = "Load Avg: 45.9, 40.0, 30.0 \nPID    MEM  \n100    500M \n";
const SWAP_TEXT = "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M";
const COMPRESSOR_TEXT = "vm.compressor.segment.total: 182761\nvm.compressor.segment.limit: 1234946\n";

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

/** A fake machine: fixed `top`/`sysctl` text, one foreign process, no CPU sample. */
function fakeCapacityDeps({ topText }: { topText: string }): MachineCapacityDeps {
  return {
    chairSessionId: () => undefined,
    comms: () => [{ comm: "/opt/homebrew/bin/bfs", pid: 100 }],
    compressorSysctl: () => COMPRESSOR_TEXT,
    cpuCount: () => CPU_COUNT,
    cpuSample: () => undefined,
    disk: () => undefined,
    elapsed: () => [],
    processes: () => [{ argv: "/opt/homebrew/bin/bfs /", pid: 100, ppid: 1 }],
    sessions: () => [],
    statRows: () => [],
    swapUsage: () => SWAP_TEXT,
    swapfileCount: () => 3,
    topReport: () => topText,
    watchedTopReport: () => undefined,
  };
}

/** What a run recorded: the seats it asked for, and the instants its clock reported. */
interface WatchCapture {
  readonly deps: MachineWatchDeps;
  readonly seated: DispatchRow[];
  readonly sleeps: number[];
}

/** Build the injected seams over a fake machine and a fake clock. */
function capture({
  topText,
  seat = () => ({ kind: "seated", slug: "machine-load-bfs-aaaaaaaa", workspace: "machine-load-bfs-aaaaaaaa" }),
  liveSignatures = () => new Set<string>(),
  idPrefix = "row",
}: {
  topText: string;
  seat?: (args: {
    row: DispatchRow;
    recordRegistered: (args: { slug: string }) => void;
  }) => DispatchSeat | Promise<DispatchSeat>;
  liveSignatures?: () => ReadonlySet<string>;
  /** Distinguishes two runs in one case, since the register folds by id and this clock never moves. */
  idPrefix?: string;
}): WatchCapture {
  const seated: DispatchRow[] = [];
  const sleeps: number[] = [];
  let nowMs = Date.parse("2026-09-19T09:00:00.000Z");
  let minted = 0;
  return {
    deps: {
      clock: {
        nowMs: () => nowMs,
        sleep: ({ ms }) => {
          sleeps.push(ms);
          nowMs += ms;
          return Promise.resolve();
        },
      },
      depsFor: () => fakeCapacityDeps({ topText }),
      liveSignatures,
      newId: () => {
        minted += 1;
        return `${idPrefix}-${String(minted).padStart(8, "0")}`;
      },
      now: () => new Date(nowMs).toISOString(),
      seat: async ({ row, recordRegistered }) => {
        seated.push(row);
        return seat({ recordRegistered, row });
      },
    },
    seated,
    sleeps,
  };
}

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "machine-watch-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** `slopweaver machine watch <tail>` — the tail starts at argv index 4. */
async function run({
  tail,
  log,
  deps,
}: {
  tail: readonly string[];
  log: Pick<Logger, "error" | "out">;
  deps: MachineWatchDeps;
}): Promise<number> {
  return runMachineWatchWithDeps({ argv: ["node", "slopweaver", "machine", "watch", ...tail], deps, log });
}

describe("runMachineWatchWithDeps", () => {
  it("prints usage on --help without sampling anything", async () => {
    const { log, out } = captureLogger();
    const watch = capture({ topText: CLEAR_TOP_TEXT });

    expect(await run({ deps: watch.deps, log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]!).toContain("usage: slopweaver machine watch");
    expect(watch.seated).toStrictEqual([]);
  });

  it("refuses an unknown flag", async () => {
    const { errs, log } = captureLogger();
    const watch = capture({ topText: CLEAR_TOP_TEXT });

    expect(await run({ deps: watch.deps, log, tail: ["--detach"] })).toBe(EXIT_USAGE);
    expect(errs.at(-1)!).toContain("usage: slopweaver machine watch");
  });

  it("exits 0 and writes nothing on a clear reading", async () => {
    const { log, out } = captureLogger();
    const watch = capture({ topText: CLEAR_TOP_TEXT });

    expect(await run({ deps: watch.deps, log, tail: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]!).toContain("machine watch: clear —");
    expect(unwrap(readDispatchRows({ home }))).toStrictEqual([]);
    expect(watch.seated).toStrictEqual([]);
  });

  it("dispatches on a hold, seats an investigation, and exits 1 as a FINDING", async () => {
    const { log, out } = captureLogger();
    const watch = capture({ topText: HOLDING_TOP_TEXT });

    expect(await run({ deps: watch.deps, log, tail: ["--home", home] })).toBe(EXIT_ERROR);

    const rows = unwrap(readDispatchRows({ home }));

    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe("row-00000001");
    expect(rows[0]!.triggers).toStrictEqual(["hold"]);
    expect(rows[0]!.load1).toBe(45.9);
    expect(rows[0]!.seated).toStrictEqual({
      kind: "seated",
      slug: "machine-load-bfs-aaaaaaaa",
      workspace: "machine-load-bfs-aaaaaaaa",
    });
    expect(watch.seated.length).toBe(1);
    expect(out[0]!).toContain("machine watch: DISPATCH");
    expect(out[1]!).toContain("register: ");
  });

  it("records the reason a spawn failed on the row, rather than dropping the dispatch", async () => {
    const { log } = captureLogger();
    const watch = capture({
      seat: () => ({ kind: "none", why: "board row registered, but cmux spawn failed: no server" }),
      topText: HOLDING_TOP_TEXT,
    });

    expect(await run({ deps: watch.deps, log, tail: ["--home", home] })).toBe(EXIT_ERROR);
    expect(unwrap(readDispatchRows({ home }))[0]!.seated).toStrictEqual({
      kind: "none",
      why: "board row registered, but cmux spawn failed: no server",
    });
  });

  it("leaves the dispatch id its board row cites when the watch dies MID-SPAWN, and the next watch seats no duplicate", async () => {
    // A live shape: the board row is registered, then `timeout 90` kills the process inside
    // `cmux spawn`. A seat that records and then never resolves is that process, frozen at the kill.
    const killed = capture({
      seat: ({ recordRegistered }) => {
        recordRegistered({ slug: "machine-load-hold-on-cpu-row-0000" });
        return Promise.reject(new Error("killed by timeout mid-spawn"));
      },
      topText: HOLDING_TOP_TEXT,
    });

    await expect(run({ deps: killed.deps, log: captureLogger().log, tail: ["--home", home] })).rejects.toThrow(
      "killed by timeout mid-spawn",
    );
    const orphan = unwrap(readDispatchRows({ home }));

    expect(orphan.map((row) => [row.id, row.seated])).toStrictEqual([
      [
        "row-00000001",
        { kind: "registered", sinceIso: "2026-09-19T09:00:00.000Z", slug: "machine-load-hold-on-cpu-row-0000" },
      ],
    ]);

    const next = capture({
      idPrefix: "later",
      liveSignatures: () =>
        liveDispatchSignatures({
          nowMs: Date.parse("2026-09-19T09:00:00.000Z"),
          rows: unwrap(readDispatchRows({ home })),
        }),
      topText: HOLDING_TOP_TEXT,
    });

    expect(await run({ deps: next.deps, log: captureLogger().log, tail: ["--home", home] })).toBe(EXIT_ERROR);
    expect(next.seated).toStrictEqual([]);
  });

  it("replaces the registered line with the seat the spawn reported", async () => {
    const watch = capture({
      seat: ({ recordRegistered }) => {
        recordRegistered({ slug: "machine-load-bfs-aaaaaaaa" });
        return { kind: "seated", slug: "machine-load-bfs-aaaaaaaa", workspace: "machine-load-bfs-aaaaaaaa" };
      },
      topText: HOLDING_TOP_TEXT,
    });

    expect(await run({ deps: watch.deps, log: captureLogger().log, tail: ["--home", home] })).toBe(EXIT_ERROR);
    expect(unwrap(readDispatchRows({ home })).map((row) => row.seated)).toStrictEqual([
      { kind: "seated", slug: "machine-load-bfs-aaaaaaaa", workspace: "machine-load-bfs-aaaaaaaa" },
    ]);
  });

  it("re-states a settlement that landed mid-spawn after its final line, so a reader without the registered arm keeps it", async () => {
    const settlement = { atIso: "2026-09-19T09:01:00.000Z", witness: "settled while the spawn was booting" };
    const watch = capture({
      seat: ({ recordRegistered, row }) => {
        recordRegistered({ slug: "machine-load-bfs-aaaaaaaa" });
        // Another session settles the row while this one is still inside `cmux spawn`.
        appendDispatchRow({ home, row: { ...row, settled: settlement } });
        return { kind: "seated", slug: "machine-load-bfs-aaaaaaaa", workspace: "machine-load-bfs-aaaaaaaa" };
      },
      topText: HOLDING_TOP_TEXT,
    });

    await run({ deps: watch.deps, log: captureLogger().log, tail: ["--home", home] });
    const lines = readFileSync(dispatchRegisterPath({ home }), "utf8").trim().split("\n");

    // registered, the other session's settle, the final seat — then the same seat re-stating the settlement,
    // because a reader without the registered arm drops the first two lines and would read the third as open.
    expect(lines.map((line) => (JSON.parse(line) as { settled?: unknown }).settled)).toStrictEqual([
      undefined,
      settlement,
      undefined,
      settlement,
    ]);
    expect((JSON.parse(lines[3]!) as { seated: unknown }).seated).toStrictEqual({
      kind: "seated",
      slug: "machine-load-bfs-aaaaaaaa",
      workspace: "machine-load-bfs-aaaaaaaa",
    });
  });

  it("still WRITES a row when a live investigation holds the signature, and opens no second seat", async () => {
    const first = capture({ topText: HOLDING_TOP_TEXT });
    await run({ deps: first.deps, log: captureLogger().log, tail: ["--home", home] });
    const signature = unwrap(readDispatchRows({ home }))[0]!.signature;
    const second = capture({
      idPrefix: "later",
      liveSignatures: () => new Set([signature]),
      topText: HOLDING_TOP_TEXT,
    });

    expect(await run({ deps: second.deps, log: captureLogger().log, tail: ["--home", home] })).toBe(EXIT_ERROR);
    const rows = unwrap(readDispatchRows({ home }));

    expect(rows.length).toBe(2);
    expect(second.seated).toStrictEqual([]);
    expect(rows.find((entry) => entry.id === "later-00000001")!.seated).toStrictEqual({
      kind: "none",
      why: `an investigation is already live on ${signature}`,
    });
  });

  it("still WRITES a row inside the backoff window, saying so — only the seat is rate-limited", async () => {
    const watch = capture({ topText: HOLDING_TOP_TEXT });
    const earlier: DispatchRow = {
      id: "d0",
      load1: 45.9,
      observedIso: "2026-09-19T08:58:00.000Z",
      seated: { kind: "none", why: "an earlier unseated dispatch" },
      settled: undefined,
      signature: "hold|hold on cpu|foreign",
      subject: { kill: undefined, label: "hold on cpu", sessionId: undefined, tree: [], why: "load 45.9" },
      triggers: ["hold"],
    };
    appendDispatchRow({ home, row: earlier });

    expect(await run({ deps: watch.deps, log: captureLogger().log, tail: ["--home", home] })).toBe(EXIT_ERROR);
    expect(watch.seated).toStrictEqual([]);
    expect(unwrap(readDispatchRows({ home }))[0]!.seated).toMatchObject({
      kind: "none",
      why: "backoff: 1 unsettled dispatch(es) on this signature, 300s window, next seat at 2026-09-19T09:03:00.000Z",
    });
  });

  it("emits the row itself, and only the row, under --json", async () => {
    const { log, out } = captureLogger();
    const watch = capture({ topText: HOLDING_TOP_TEXT });

    expect(await run({ deps: watch.deps, log, tail: ["--home", home, "--json"] })).toBe(EXIT_ERROR);
    expect(out.length).toBe(1);
    expect((JSON.parse(out[0]!) as { id: string }).id).toBe("row-00000001");
  });

  it("takes exactly one sample by default, with no sleep", async () => {
    const watch = capture({ topText: CLEAR_TOP_TEXT });

    await run({ deps: watch.deps, log: captureLogger().log, tail: ["--home", home, "--once"] });

    expect(watch.sleeps).toStrictEqual([]);
  });

  it("samples on the interval across a bounded window", async () => {
    const watch = capture({ topText: CLEAR_TOP_TEXT });
    const { out } = captureLogger();
    const log = { error: () => undefined, out: ({ line }: { line: string }) => out.push(line) };

    await run({ deps: watch.deps, log, tail: ["--home", home, "--for-seconds", "180", "--interval-seconds", "60"] });

    expect(watch.sleeps).toStrictEqual([60_000, 60_000, 60_000]);
    expect(out.length).toBe(4);
  });

  it("clamps an interval below the floor rather than spinning", async () => {
    const watch = capture({ topText: CLEAR_TOP_TEXT });

    await run({
      deps: watch.deps,
      log: captureLogger().log,
      tail: ["--home", home, "--for-seconds", "60", "--interval-seconds", "1"],
    });

    expect(watch.sleeps).toStrictEqual([MIN_INTERVAL_SECONDS * 1000, MIN_INTERVAL_SECONDS * 1000]);
  });

  it("clamps --for-seconds HARD and says so — a longer watch would be a resident daemon", async () => {
    const { errs, log } = captureLogger();
    const watch = capture({ topText: CLEAR_TOP_TEXT });

    await run({
      deps: watch.deps,
      log,
      tail: ["--home", home, "--for-seconds", "86400", "--interval-seconds", "300"],
    });

    expect(errs[0]!).toContain(`--for-seconds is capped at ${String(MAX_WATCH_SECONDS)}s and was clamped to it`);
    expect(watch.sleeps.length).toBe(MAX_WATCH_SECONDS / 300);
  });
});
