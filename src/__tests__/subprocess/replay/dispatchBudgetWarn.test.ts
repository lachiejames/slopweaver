/**
 * REPLAY LANE — the long dispatch that nobody warned, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/long-dispatch-no-warn-12sep`) is that ask's own record set frozen through its
 * `dispatched` event: a fresh visible worker on a two-hour lease, which went on to run six review rounds and
 * answer 3h40m later with nothing ever telling it a clock was running. The owner
 * ruled that the LOOP session raises the warn, on the sweep pass it already runs, with zero new sessions —
 * so everything here drives `turn dispatch --sweep` and its scoped `--warn` form, and nothing else.
 *
 * The replay clock is advanced with `--now` across the provisional warn mark, 05:44:52.099Z (two thirds of
 * the lease). cmux is unreachable and no bot token exists, so the sweep can read and record but can never
 * reach a thread: **the falsifiable witness that the warn posted nothing** is the finaliser's own line,
 * `could not finalise its indicators`, which prints exactly when a post is attempted — see
 * `dispatchOrphanSweep.test.ts` for where it was first used.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "long-dispatch-no-warn-12sep";
const DISPATCHED = "2026-09-12T04:24:59.799Z";
const BEFORE_MARK = "2026-09-12T05:30:00.000Z";
const PAST_MARK = "2026-09-12T05:50:00.000Z";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-budget-warn-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home with no real config: `HOME` is the throwaway
 * directory and `CMUX_SOCKET_PATH` names a socket that does not exist.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(BIN, [...args, "--home", home], {
    cwd: workspace,
    encoding: "utf8",
    env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: absentAsNumber({ value: run.status, whenAbsent: 1 }), stderr: run.stderr, stdout: run.stdout };
}

/**
 * The warn rows the fixture's progress log carries right now, parsed.
 *
 * @param channel the fixture ask's synthetic channel
 * @param messageTs the fixture ask's message ts
 * @returns every `warn` row, in file order
 */
function warnRows({ channel, messageTs }: { channel: string; messageTs: string }): readonly Record<string, unknown>[] {
  const path = join(home, "live", "slack", "progress", `${channel}-${messageTs}.jsonl`);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line))
    .filter(isRecord)
    .filter((row) => row["kind"] === "warn");
}

describe("replay: long-dispatch-no-warn-12sep", () => {
  it("reports the evidence before the mark and records no warn", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const ask = `${manifest.ask.channel}/${manifest.ask.messageTs}`;
    const result = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", BEFORE_MARK] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `budget: ${ask} — dispatched ${DISPATCHED}; 65m of 119m, warn mark 2026-09-12T05:44:52.099Z in 14m; ` +
        "0 stages this dispatch; no review this dispatch; warn: none",
    );
    expect(warnRows(manifest.ask)).toEqual([]);
  });

  it("raises exactly one clock warn past the mark, and never a second", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const ask = `${manifest.ask.channel}/${manifest.ask.messageTs}`;
    const first = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_MARK] });
    const second = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", "2026-09-12T05:55:00.000Z"] });
    expect(first.stdout).toContain(`budget warn raised (clock): ${ask} — the warn mark was crossed`);
    expect(second.stdout).not.toContain("budget warn raised");
    expect(second.stdout).toContain(`warn: clock ${PAST_MARK}`);
    expect(warnRows(manifest.ask)).toEqual([
      {
        dispatchedIso: DISPATCHED,
        kind: "warn",
        leaseExpiresAt: "2026-09-12T06:24:48.249Z",
        schemaVersion: 1,
        source: "clock",
        tsIso: PAST_MARK,
      },
    ]);
  });

  it("posts nothing into the thread when the warn is raised, and the ask stays dispatched", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const asksBefore = readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8");
    const result = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_MARK] });
    // Positive half first, so the absence below is read against a sweep that demonstrably did its work.
    expect(result.stdout).toContain(
      "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired",
    );
    expect(warnRows(manifest.ask).length).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain("could not finalise its indicators");
    expect(readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")).toBe(asksBefore);
  });

  it("records the loop's one witness note locally, and it suppresses the later clock warn", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const ask = `${manifest.ask.channel}/${manifest.ask.messageTs}`;
    const note = runSlopweaver({
      args: [
        "turn",
        "dispatch",
        "--sweep",
        "--ask",
        ask,
        "--warn",
        "stages stopped naming anything new",
        "--warn-dispatched",
        DISPATCHED,
        "--now",
        BEFORE_MARK,
      ],
    });
    expect(note.status).toBe(0);
    expect(note.stdout).toBe(`budget warn recorded (witness): ${ask} — dispatched ${DISPATCHED}\n`);
    const later = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_MARK] });
    expect(later.stdout).not.toContain("budget warn raised (clock)");
    expect(later.stdout).toContain(`warn: witness ${BEFORE_MARK}`);
    expect(warnRows(manifest.ask).map((row) => [row["source"], row["note"]])).toEqual([
      ["witness", "stages stopped naming anything new"],
    ]);
  });

  it("refuses a second witness note and leaves the log unchanged", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const ask = `${manifest.ask.channel}/${manifest.ask.messageTs}`;
    const noteArgs = ({ text, now }: { text: string; now: string }): readonly string[] => [
      "turn",
      "dispatch",
      "--sweep",
      "--ask",
      ask,
      "--warn",
      text,
      "--warn-dispatched",
      DISPATCHED,
      "--now",
      now,
    ];
    runSlopweaver({ args: noteArgs({ now: BEFORE_MARK, text: "circling on round 2" }) });
    const second = runSlopweaver({ args: noteArgs({ now: PAST_MARK, text: "still circling" }) });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("this dispatch already carries a witness note");
    expect(warnRows(manifest.ask).length).toBe(1);
  });

  it("refuses a note judged against a dispatch that is no longer current", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const ask = `${manifest.ask.channel}/${manifest.ask.messageTs}`;
    const stale = runSlopweaver({
      args: [
        "turn",
        "dispatch",
        "--sweep",
        "--ask",
        ask,
        "--warn",
        "circling",
        "--warn-dispatched",
        "2026-09-12T01:00:00.000Z",
        "--now",
        PAST_MARK,
      ],
    });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(`is not this ask's current dispatch (${DISPATCHED})`);
    expect(warnRows(manifest.ask)).toEqual([]);
  });

  it("refuses --warn outside the scoped sweep", { timeout: 60_000 }, () => {
    materialiseFixture({ into: home, slug: SLUG });
    const unscoped = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--warn", "circling"] });
    const notSweep = runSlopweaver({ args: ["turn", "dispatch", "--poll", "x", "--warn", "circling"] });
    expect([unscoped.status, notSweep.status]).toEqual([2, 2]);
    expect(unscoped.stderr).toContain("--warn needs --ask <channel>/<messageTs> and --warn-dispatched <iso> together");
    expect(notSweep.stderr).toContain("--warn is a form of --sweep, and only of --sweep");
  });

  it("reads the witness note back to the worker neutrally, on its own resume", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const ask = `${manifest.ask.channel}/${manifest.ask.messageTs}`;
    runSlopweaver({
      args: [
        "turn",
        "dispatch",
        "--sweep",
        "--ask",
        ask,
        "--warn",
        "round 1 came back broken on the core deliverable",
        "--warn-dispatched",
        DISPATCHED,
        "--now",
        BEFORE_MARK,
      ],
    });
    const dispatchId = JSON.stringify([manifest.ask.channel, manifest.ask.messageTs, manifest.ask.threadTs]);
    const resumed = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId] });
    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toContain(
      "BUDGET: warn mark 2026-09-12T05:44:52.099Z (provisional, two thirds of this dispatch's lease to 2026-09-12T06:24:48.249Z).",
    );
    expect(resumed.stdout).toContain(
      `BUDGET WARN raised ${BEFORE_MARK} by the loop's sweep (witness): round 1 came back broken on the core deliverable. ` +
        "An observation for your own plan — how this turn ends stays your call.",
    );
  });
});
