/**
 * `supervisor tick-capture`, `supervisor scratch-carry` and `supervisor refresh-run` end to end over a real temp
 * directory. The one injected seam is the child launcher (`./scratchFakes.ts`), so what is under test is every file
 * the verb creates, refuses to overwrite, or leaves alone. A refresh-run's child list replaces run.json only when it
 * is a document the page can read, and every refusal leaves the old file and says why.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAutonomyAction } from "../../../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../../../autonomy/types.js";
import type { ScratchDeps } from "../../../../../cli/commands/supervisor/scratchDeps.js";
import {
  REFRESH_DEADLINE_MS,
  REFRESH_TIMEOUT_MS,
  runRefreshRun,
} from "../../../../../cli/commands/supervisor/scratchRefresh.js";
import { runScratchCarry, runTickCapture } from "../../../../../cli/commands/supervisor/scratchRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, unwrap } from "../../../../../lib/result.js";
import {
  READING_TIMEOUT_MS,
  type TickCapture,
  WAKE_READING_TIMEOUT_MS,
} from "../../../../../supervisor/scratch/tickCapture.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  memoryAutonomyLedgerPort,
  seedAutonomyRecords,
  unavailableAutonomyLedgerPort,
} from "../../../../autonomyLedgerFixture.js";
import { fakeDeps } from "./scratchFakes.js";

/** One valid act, whose `said` carries the reference a test qualifies. */
function autonomyAct({ actionId, said }: { actionId: string; said: string }): AutonomyActionRow {
  return unwrap(
    buildAutonomyAction({
      actionId,
      bySession: "workspace:1 demo",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "press-merge-when-ready",
      run: undefined,
      said,
      steer: undefined,
      subject: "https://github.com/acme/acme-admin/pull/12",
      why: "CI green and mergeable",
      witness: "slopweaver github enqueue --pr 12 -> queued",
    }),
  );
}

/**
 * A session-start document's opening, unclosed: closed with `}` it is the smallest run the page reads, and left
 * open it is a child's output cut off mid-write.
 */
const RUN_HEAD = '{"nowIso":"2026-09-16T01:00:00.000Z","ranking":{"ranked":[]}';

/**
 * Every staging file a refresh left in the scratch directory, whatever its per-invocation suffix.
 *
 * @returns the names, sorted
 */
function stagedLeft({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("run.json.session-start"))
    .toSorted();
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scratch-verbs-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("supervisor tick-capture", () => {
  it("writes every reading to its own file under tick-<label> and records the capture", async () => {
    const fake = fakeDeps({
      answers: {
        "handover reconcile": { exit: 1, stdout: '{"found":true}' },
        "velocity --json": { exit: 1, stdout: "" },
      },
    });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a"],
    });
    expect(code).toBe(EXIT_OK);
    const dir = join(root, "tick-4");
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as TickCapture;
    expect(capture.readings.length).toBe(fake.launched.length);
    expect(fake.launched[0]).toBe("/checkout/bin/slopweaver events tail --cursor supervisor");
    expect(capture.startedIso).toBe("2026-09-16T01:00:00.000Z");
    expect(capture.capturedIso).toBe("2026-09-16T01:02:00.000Z");
    expect(readFileSync(join(dir, "reconcile.json"), "utf8")).toBe('{"found":true}');
    expect(readFileSync(join(dir, "capacity.json"), "utf8")).toBe("{}");
    expect(capture.tickDraftArgs.includes("--velocity")).toBe(false);
    expect(capture.tickDraftArgs.includes("--reconcile")).toBe(true);
    expect(capture.tickDraftArgs.includes(join(dir, "reconcile.json"))).toBe(true);
    expect(fake.out[1]).toBe(`  velocity: exit 1 — see ${dir}/velocity.err`);
  });

  it("appends every completed JSON reading to the readings ledger as tick-<label>, by its verb words", async () => {
    // `--home` names the ambient home itself, so the capture is the chair's ordinary, unconfined one.
    const fake = fakeDeps({
      ambientHome: "/state/home",
      answers: {
        "claude gauge": { exit: 0, stdout: '{"gauge":1}' },
        "velocity --json": { exit: 0, stdout: '{"velocity":2}' },
        "turn blocked": { exit: 0, stdout: "" },
      },
    });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a", "--home", "/state/home"],
    });
    expect(code).toBe(EXIT_OK);
    const dir = join(root, "tick-4");
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as TickCapture;
    const gauge = fake.appended.find((row) => row.producer === "claude gauge")!;
    expect(gauge).toEqual({ by: "tick-4", document: '{"gauge":1}', home: "/state/home", producer: "claude gauge" });
    expect(fake.appended.map((row) => row.producer)).toContain("velocity");
    expect(fake.appended.map((row) => row.producer)).not.toContain("turn blocked");
    expect(fake.appended.map((row) => row.producer)).not.toContain("events tail");
    expect(capture.readings.find((reading) => reading.name === "gauge-report")!.readingId).toBe(
      `claude gauge-row-${String(fake.appended.findIndex((row) => row.producer === "claude gauge") + 1)}`,
    );
    expect(capture.readings.find((reading) => reading.name === "velocity")!.readingId).toBeUndefined();
    expect(capture.readings.find((reading) => reading.name === "blocked")!.readingId).toBeUndefined();
    expect(fake.diagnostics).toContain(
      "supervisor tick-capture: velocity was not appended to the readings ledger — the readings ledger is busy",
    );
    expect(fake.out).toContain(
      `  ${String(fake.appended.length - 1)} readings appended to the readings ledger as tick-4`,
    );
    expect(fake.childHomes.length).toBeGreaterThan(0);
    expect(fake.childHomes.filter((home) => home !== undefined)).toEqual([]);
  });

  it("keeps a cadence skip in the tick's own file but never appends it to the readings ledger", async () => {
    const skip =
      '{"cadenceMinutes":30,"kind":"skipped","lastReadAtIso":"2026-10-01T14:21:40.562Z","nextDueAtIso":"2026-10-01T14:51:40.562Z","selection":"o/r@@me","why":"not due"}';
    const fake = fakeDeps({
      answers: {
        "claude gauge": { exit: 0, stdout: skip },
        "machine capacity": { exit: 0, stdout: '{"capacity":3}' },
      },
    });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a"],
    });
    expect(code).toBe(EXIT_OK);
    const dir = join(root, "tick-4");
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as TickCapture;
    expect(readFileSync(join(dir, "gauge-report.json"), "utf8")).toBe(skip);
    expect(fake.appended.map((row) => row.producer)).not.toContain("claude gauge");
    expect(fake.appended.find((row) => row.producer === "machine capacity")!.document).toBe('{"capacity":3}');
    expect(capture.readings.find((reading) => reading.name === "gauge-report")!.readingId).toBeUndefined();
  });

  it("gives every reading a budget and names one it killed, keeping it out of the draft", async () => {
    const fake = fakeDeps({ answers: { "velocity --json": { exit: "timed-out", stdout: '{"half' } } });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a"],
    });
    expect(code).toBe(EXIT_OK);
    const dir = join(root, "tick-4");
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as TickCapture;
    const velocity = capture.readings.find((reading) => reading.name === "velocity")!;
    expect(fake.budgets.filter((budget) => budget !== READING_TIMEOUT_MS)).toEqual([WAKE_READING_TIMEOUT_MS]);
    expect(fake.budgets.length).toBe(capture.readings.length);
    expect(velocity.child).toEqual({ durationMs: 120_003, kind: "timed-out", signal: "SIGKILL", timeoutMs: 120_000 });
    expect(velocity.exitCode).toBe(null);
    expect(velocity.readingId).toBeUndefined();
    expect(capture.tickDraftArgs.includes("--velocity")).toBe(false);
    expect(fake.out[1]).toBe(`  velocity: timed out after 120s (killed) — see ${dir}/velocity.err`);
  });

  it("takes an empty exit-0 watch once more and keeps only the second attempt", async () => {
    const report = '{"observedAtIso":"2026-09-16T01:01:00.000Z","rows":[],"suppressed":0,"diagnostics":[]}';
    const fake = fakeDeps({ answers: { "session watch": { exit: 0, stdout: ["", report] } } });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a"],
    });
    expect(code).toBe(EXIT_OK);
    const dir = join(root, "tick-4");
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as TickCapture;
    const watchReport = capture.readings.find((reading) => reading.name === "watch-report")!;
    const reportLaunch = "/checkout/bin/slopweaver session watch --idle-minutes 10 --json-report";
    expect(fake.launched.filter((line) => line === reportLaunch).length).toBe(2);
    expect(readFileSync(join(dir, "watch-report.json"), "utf8")).toBe(report);
    expect(watchReport.completed).toBe(true);
    expect(watchReport.retried).toBe(true);
    expect(watchReport.bytes).toBe(report.length);
    expect(capture.tickDraftArgs.includes(join(dir, "watch-report.json"))).toBe(true);
    expect(fake.appended.filter((row) => row.producer === "session watch").map((row) => row.document)).toEqual([
      report,
    ]);
    expect(fake.out[1]).toBe("  retried once after an empty first attempt: watch, watch-report");
  });

  it("calls a watch empty twice a failed reading, out of the draft and the ledger", async () => {
    const fake = fakeDeps({ answers: { "session watch": { exit: 0, stdout: "" } } });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a"],
    });
    expect(code).toBe(EXIT_OK);
    const dir = join(root, "tick-4");
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")) as TickCapture;
    const watchReport = capture.readings.find((reading) => reading.name === "watch-report")!;
    expect(watchReport.completed).toBe(false);
    expect(watchReport.retried).toBe(true);
    expect(watchReport.exitCode).toBe(0);
    expect(capture.tickDraftArgs.includes("--watch")).toBe(false);
    expect(fake.appended.map((row) => row.producer)).not.toContain("session watch");
    expect(fake.out.slice(1, 3)).toEqual([
      `  watch: exit 0 with nothing on stdout, twice — see ${dir}/watch.err`,
      `  watch-report: exit 0 with nothing on stdout, twice — see ${dir}/watch-report.err`,
    ]);
  });

  it("never retries an empty reading that did not declare it must print", async () => {
    const fake = fakeDeps({ answers: { "turn blocked": { exit: 0, stdout: "" } } });
    await runTickCapture({ deps: fake.deps, rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a"] });
    const capture = JSON.parse(readFileSync(join(root, "tick-4", "capture.json"), "utf8")) as TickCapture;
    const blocked = capture.readings.find((reading) => reading.name === "blocked")!;
    expect(fake.launched.filter((line) => line.endsWith("turn blocked --json")).length).toBe(1);
    expect(blocked.completed).toBe(true);
    expect(blocked.retried).toBeUndefined();
  });

  it("refuses a tick directory that already exists, launching nothing", async () => {
    mkdirSync(join(root, "tick-4"));
    const fake = fakeDeps();
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "k"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.launched).toEqual([]);
    expect(fake.diagnostics[0]).toContain("already exists");
  });

  it("refuses a label that would leave the directory, as a usage mistake", async () => {
    const fake = fakeDeps();
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "../x", "--loop-session-key", "k"],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("supervisor scratch-carry", () => {
  /**
   * A predecessor directory holding the inherited state beside a reading and a script.
   *
   * @returns its path
   */
  function predecessor(): string {
    const from = join(root, "handoff-9270");
    mkdirSync(join(from, "archive"), { recursive: true });
    writeFileSync(join(from, "form.json"), '{"form":1}');
    writeFileSync(join(from, "open-pages.json"), "[]");
    writeFileSync(join(from, "reconcile270-4.json"), "x".repeat(1000));
    writeFileSync(join(from, "tick.sh"), "#!/bin/zsh\n");
    return from;
  }

  it("copies only the allowlist into a fresh successor directory", async () => {
    const from = predecessor();
    const to = join(root, "handoff-9271");
    const fake = fakeDeps();
    expect(runScratchCarry({ deps: fake.deps, rest: ["--from", from, "--to", to] })).toBe(EXIT_OK);
    expect(readdirSync(to).toSorted()).toEqual(["form.json", "open-pages.json"]);
    expect(readFileSync(join(to, "form.json"), "utf8")).toBe('{"form":1}');
    expect(fake.out).toContain("  shell.txt: absent in the predecessor — nothing to inherit");
  });

  it("writes nothing under --dry-run", async () => {
    const from = predecessor();
    const to = join(root, "handoff-9271");
    const fake = fakeDeps();
    expect(runScratchCarry({ deps: fake.deps, rest: ["--from", from, "--to", to, "--dry-run", "--json"] })).toBe(
      EXIT_OK,
    );
    expect(existsSync(to)).toBe(false);
    expect(JSON.parse(fake.out[0]!)).toEqual({
      dryRun: true,
      files: [
        { bytes: 10, name: "form.json", status: "carried" },
        { bytes: 2, name: "open-pages.json", status: "carried" },
        { bytes: 0, name: "shell.txt", status: "absent" },
      ],
      from,
      leftBehind: { bytes: 1011, entries: 3 },
      to,
    });
  });

  it("refuses, copying nothing, when the successor already holds an inherited file", async () => {
    const from = predecessor();
    const to = join(root, "handoff-9271");
    mkdirSync(to);
    writeFileSync(join(to, "open-pages.json"), "mine");
    const fake = fakeDeps();
    expect(runScratchCarry({ deps: fake.deps, rest: ["--from", from, "--to", to] })).toBe(EXIT_ERROR);
    expect(readdirSync(to)).toEqual(["open-pages.json"]);
    expect(readFileSync(join(to, "open-pages.json"), "utf8")).toBe("mine");
  });

  it("refuses a carry into its own source", async () => {
    const from = predecessor();
    const fake = fakeDeps();
    expect(runScratchCarry({ deps: fake.deps, rest: ["--from", from, "--to", `${from}/`] })).toBe(EXIT_USAGE);
  });
});

describe("supervisor refresh-run", () => {
  it("rewrites run.json and the store's autonomy ledger with every bare reference qualified", async () => {
    const autonomy = memoryAutonomyLedgerPort();
    const bare = autonomyAct({ actionId: "12-enqueue", said: "Queued #12 to merge." });
    const qualifiedAlready = autonomyAct({ actionId: "3-enqueue", said: "Queued x/y#3 to merge." });
    await seedAutonomyRecords({ port: autonomy, records: [bare, qualifiedAlready] });
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    const fake = fakeDeps({
      answers: { "session-start --json": { exit: 0, stdout: `${RUN_HEAD},"items":["#1,#2"]}\n` } },
      autonomy,
    });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe(`${RUN_HEAD},"items":["o/r#1,o/r#2"]}\n`);
    expect(readFileSync(join(scratch, "autonomy-qualified.jsonl"), "utf8")).toBe(
      `${JSON.stringify(bare).replace("Queued #12", "Queued o/r#12")}\n${JSON.stringify(qualifiedAlready)}\n`,
    );
    expect(stagedLeft({ dir: scratch })).toEqual([]);
    expect(fake.out).toEqual([
      `supervisor refresh-run: wrote ${join(scratch, "run.json")} — 2 bare reference(s) qualified as o/r`,
      `  wrote ${join(scratch, "autonomy-qualified.jsonl")} — 2 record(s), 1 bare reference(s) qualified`,
    ]);
  });

  it("refuses rather than leave a stale autonomy copy when the store cannot be read", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "autonomy-qualified.jsonl"), "old\n");
    const fake = fakeDeps({
      answers: { "session-start --json": { exit: 0, stdout: `${RUN_HEAD}}\n` } },
      autonomy: unavailableAutonomyLedgerPort(),
    });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.diagnostics[0]).toBe(
      `supervisor refresh-run: the autonomy ledger could not be read from the store: ${AUTONOMY_FIXTURE_OUTAGE.message}`,
    );
    expect(readFileSync(join(scratch, "autonomy-qualified.jsonl"), "utf8")).toBe("old\n");
  });

  it("keeps the old run.json when session-start fails", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 1, stdout: "partial" } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(fake.diagnostics[0]).toBe(
      "supervisor refresh-run: `slopweaver session-start --json --no-record --deadline 2026-09-16T01:05:00.000Z` exit 1",
    );
  });

  it("keeps the old run.json when session-start exits 0 having printed nothing", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout: "" } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(fake.diagnostics[0]).toBe(
      "supervisor refresh-run: `slopweaver session-start --json --no-record --deadline 2026-09-16T01:05:00.000Z` exited 0 but printed nothing, so the file it would have replaced was left as it was",
    );
  });

  it("keeps the old run.json when session-start exits 0 with JSON that is no session-start run", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout: "{}\n" } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(stagedLeft({ dir: scratch })).toEqual([]);
    expect(fake.diagnostics[0]).toBe(
      "supervisor refresh-run: `slopweaver session-start --json --no-record --deadline 2026-09-16T01:05:00.000Z` exited 0 but printed no readable document (nowIso: Invalid input: expected string, received undefined; ranking: Invalid input: expected object, received undefined), so the file it would have replaced was left as it was",
    );
  });

  it("keeps the old run.json when session-start dates its run with an instant no clock reads", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const stdout = '{"nowIso":"not-a-date","ranking":{"ranked":[]}}\n';
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(fake.diagnostics[0]).toContain(
      "(nowIso: must be an ISO-8601 timestamp a clock can parse, as in `2026-09-25T10:49:08Z`)",
    );
  });

  it("keeps the old run.json when qualifying its references makes a readable document unreadable", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    // 40 characters, the cap, and parseable as printed; qualified as `o/r#1` it is 43.
    const nowIso = "2020-01-01 (aaaaaaaaaaaaaaaaaaaaaaaa #1)";
    const stdout = `{"nowIso":"${nowIso}","ranking":{"ranked":[]}}\n`;
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(nowIso.length).toBe(40);
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(stagedLeft({ dir: scratch })).toEqual([]);
    expect(fake.diagnostics[0]).toContain("printed no readable document (nowIso:");
  });

  it("never promotes a second refresh's child output, even when it runs inside the first's launch", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const rest = ["--dir", scratch, "--home", join(root, "home")];
    const first = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout: `${RUN_HEAD},"by":"A"}\n` } } });
    const second = fakeDeps({ answers: { "session-start --json": { exit: 7, stdout: `${RUN_HEAD},"by":"B"}\n` } } });
    let secondCode: number | undefined;
    const deps: ScratchDeps = {
      ...first.deps,
      runChild: async (launch) => {
        const outcome = await first.deps.runChild(launch);
        // B launches and fails while A's child is still being waited on: A's staged file is A's alone.
        secondCode = await runRefreshRun({ deps: second.deps, rest });
        return outcome;
      },
    };
    const code = await runRefreshRun({ deps, rest });
    expect(secondCode).toBe(EXIT_ERROR);
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe(`${RUN_HEAD},"by":"A"}\n`);
    expect(stagedLeft({ dir: scratch })).toEqual([]);
  });

  it("reports why the list was refused even when the staged file cannot then be removed", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout: RUN_HEAD } } });
    const deps: ScratchDeps = {
      ...fake.deps,
      runChild: async (launch) => {
        const outcome = await fake.deps.runChild(launch);
        chmodSync(scratch, 0o555);
        return outcome;
      },
    };
    try {
      const code = await runRefreshRun({ deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
      expect(code).toBe(EXIT_ERROR);
      expect(fake.diagnostics[0]).toContain("exited 0 but printed no readable document (not JSON: ");
      expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    } finally {
      chmodSync(scratch, 0o755);
    }
  });

  it("keeps the old run.json when session-start exits 0 having printed a truncated document", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout: RUN_HEAD } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(fake.diagnostics[0]).toContain("exited 0 but printed no readable document (not JSON: ");
  });

  it("keeps the old run.json when session-start overruns its budget, and says it was killed", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    writeFileSync(join(scratch, "run.json"), "old\n");
    const fake = fakeDeps({ answers: { "session-start --json": { exit: "timed-out", stdout: '{"partial' } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(join(scratch, "run.json"), "utf8")).toBe("old\n");
    expect(fake.budgets).toEqual([REFRESH_TIMEOUT_MS]);
    expect(fake.diagnostics[0]).toBe(
      "supervisor refresh-run: `slopweaver session-start --json --no-record --deadline 2026-09-16T01:05:00.000Z` timed out after 420s (killed)",
    );
  });

  it("tells session-start to stop reading two minutes inside the budget that kills it", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    const fake = fakeDeps({ answers: { "session-start --json": { exit: 0, stdout: `${RUN_HEAD}}\n` } } });
    const code = await runRefreshRun({ deps: fake.deps, rest: ["--dir", scratch, "--home", join(root, "home")] });
    expect(code).toBe(EXIT_OK);
    expect(fake.launched).toEqual([
      "/checkout/bin/slopweaver session-start --json --no-record --deadline 2026-09-16T01:05:00.000Z",
    ]);
    expect(REFRESH_TIMEOUT_MS - REFRESH_DEADLINE_MS).toBe(120_000);
  });

  it("refuses without --repo when the checkout names no repository", async () => {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    const fake = fakeDeps();
    const deps: ScratchDeps = { ...fake.deps, defaultRepo: () => err(["no origin remote"]) };
    expect(await runRefreshRun({ deps, rest: ["--dir", scratch] })).toBe(EXIT_USAGE);
    expect(fake.diagnostics[0]).toBe("supervisor refresh-run: --repo is required here: no origin remote");
  });
});
