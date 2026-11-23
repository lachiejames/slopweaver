/**
 * REPLAY LANE — the never-dispatched-card incident, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/card-posted-never-dispatched`) is that ask's whole record set, and its whole
 * record set is two events: `captured`, then `checklist-posted`. Nothing follows, and that IS the incident.
 * A burst-queued follow-up was promoted and given the full capture-time UX — `:eyes:` and a progress card —
 * by `turn answer` running inside the PREVIOUS ask's one-shot fresh-visible-session child, which printed the
 * burst handoff line to its own stdout and then exited. No session ever routed it, so no `dispatched` event
 * was ever written; every arm of `turn dispatch --sweep` keyed on `activeDispatch` and returned early, and
 * the card stood on `Work out how to answer` in a public channel for six hours while the message queued
 * behind it was stranded for good.
 *
 * There is nothing to freeze `--through`, because the defect wrote no event: the state at the moment before
 * it fired and the state six hours later are the same two rows. What separates them is the CLOCK, which is
 * why both tests below run the same fixture and differ only in `--now`.
 *
 * **The falsifiable witness for "the card was corrected".** Finalising a swept ask's indicators prints
 * `could not finalise its indicators — no Slack bot token is configured` when no bot token is present — a
 * line that appears when, and only when, a post was ATTEMPTED. Its absence in the control run is therefore
 * evidence rather than silence, and its presence in the incident run proves the arm reached the door.
 *
 * **What changed, and why this file's control run inverted.** The early run used to assert
 * the sweep said NOTHING at the fixture's own clock. That silence was the second half of the same incident,
 * measured again on a different ask: a burst survivor was carded in a public channel and every
 * sweep run in the next 33 minutes reported a clean board, because the only arm that could see it waits
 * thirty minutes to fire. An `unrouted` finding now reports from minute zero and settles nothing, so the
 * CLOCK still separates the two runs — one finalises a card, the other does not — and silence is no longer
 * one of the two states. The witness above is what makes "settles nothing" evidence rather than an absence.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Six hours after the fixture's own clock — when the owner found the card still standing. */
const SIX_HOURS_LATER = "2026-08-31T10:36:19.928Z";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-never-dispatched-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config: `HOME` is the throwaway directory, so no bot token and no cmux daemon is reachable.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  // `spawnSync`, not `execFileSync`: the latter returns stdout ALONE on a zero exit and discards stderr, so
  // the finalisation witness this file's header names would read as an empty string on exactly the run that
  // is supposed to print it.
  const result = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("replay: card-posted-never-dispatched", () => {
  it("finalises the card no session ever routed, six hours on", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "card-posted-never-dispatched" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", SIX_HOURS_LATER],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `NEVER-DISPATCHED — ROUTE IT NOW: ${manifest.ask.channel}/${manifest.ask.messageTs} — ` +
        "no session ever picked this up — it was seen 360m ago (last event 2026-08-31T04:36:19.928Z) and no " +
        "routing decision was ever recorded for it",
    );
    // The line ends in the command that routes it, and NOT in the two flags a caller might think it needs:
    // `turn brief` recovers the capture-time card from the ledger, so supplying a pair by hand is how a
    // second card gets posted over the one the person is already watching.
    expect(result.stdout).toContain(
      `slopweaver turn brief --channel ${manifest.ask.channel} --message-ts ${manifest.ask.messageTs}`,
    );
    expect(result.stdout).not.toContain("--turn-id");
    expect(result.stdout).toContain(
      "sweep: 0 UNROUTED, 1 NEVER-DISPATCHED — 1 ask(s) above need routing NOW; 0 ready, 0 still working, 0 in-review, " +
        "0 worker-failed, 0 phantom, 0 lease-expired, 0 checklist-update-failed, 0 ignored",
    );
    // The witness from this file's header: the arm reached the door rather than only writing a ledger row.
    expect(result.stderr).toContain("could not finalise its indicators — no Slack bot token is configured");
  });

  it("records the terminal event that drains whatever was queued behind it", { timeout: 60_000 }, () => {
    materialiseFixture({ into: home, slug: "card-posted-never-dispatched" });
    runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--home", home, "--now", SIX_HOURS_LATER] });
    const rows = readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): { kind: string; reason?: string } => JSON.parse(line) as { kind: string; reason?: string });
    expect(rows.map((row) => row.kind)).toEqual(["captured", "checklist-posted", "dispatch-failed"]);
    // `dispatch-failed` is a burst-slot RELEASE (`live/ask/burst.ts#burstSlotRelease`), which is the half the
    // incident needed most: the follow-up queued behind this ask had been waiting seventeen hours.
    expect(rows[2]!.reason).toBe(
      "no session ever picked this up — it was seen 360m ago (last event 2026-08-31T04:36:19.928Z) and no " +
        "routing decision was ever recorded for it",
    );
  });

  it("scopes to one ask with --ask, which is how a backlog is corrected a card at a time", { timeout: 60_000 }, () => {
    // Why the flag exists: a sweep FINALISES what it finds, and this install carried 23 asks in exactly this
    // state — the oldest 17 days — when the arm was written, so the first unscoped run would have posted into
    // 23 threads at once.
    const manifest = materialiseFixture({ into: home, slug: "card-posted-never-dispatched" });
    const result = runSlopweaver({
      args: [
        "turn",
        "dispatch",
        "--sweep",
        "--ask",
        `${manifest.ask.channel}/${manifest.ask.messageTs}`,
        "--home",
        home,
        "--now",
        SIX_HOURS_LATER,
      ],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "sweep: 0 UNROUTED, 1 NEVER-DISPATCHED — 1 ask(s) above need routing NOW; 0 ready, 0 still working, 0 in-review, " +
        "0 worker-failed, 0 phantom, 0 lease-expired, 0 checklist-update-failed, 0 ignored",
    );
  });

  it(
    "refuses an --ask this home carries no record of, rather than reporting a healthy empty sweep",
    { timeout: 60_000 },
    () => {
      const manifest = materialiseFixture({ into: home, slug: "card-posted-never-dispatched" });
      const result = runSlopweaver({
        args: ["turn", "dispatch", "--sweep", "--ask", `${manifest.ask.channel}/9999999999.000000`, "--home", home],
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        `turn dispatch --sweep --ask: no ask ${manifest.ask.channel}/9999999999.000000 in this home`,
      );
      expect(result.stdout).not.toContain("sweep: ");
    },
  );

  /**
   * This test's premise INVERTED, and the inversion is the fix.
   *
   * It used to assert that at the fixture's own clock the sweep said nothing at all, so that the finding was
   * the WAIT and not the shape. That silence turned out to be the second half of the same incident: a burst
   * survivor was carded in a public channel and every sweep run in the next 33 minutes reported
   * a clean board, because the only arm that could see it waited thirty minutes to fire.
   *
   * So the wait is still the thing that separates the two findings — one settles a card, the other does not
   * — but silence is no longer one of them. What this run must now prove is that the early finding REPORTS
   * and SETTLES NOTHING.
   */
  it("reports at the fixture's own clock, and settles nothing there", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "card-posted-never-dispatched" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.stdout).toContain(
      `UNROUTED — ROUTE IT NOW: ${manifest.ask.channel}/${manifest.ask.messageTs} — captured 0m ago`,
    );
    expect(result.stdout).toContain(
      "sweep: 1 UNROUTED, 0 NEVER-DISPATCHED — 1 ask(s) above need routing NOW; 0 ready, 0 still working, 0 in-review, " +
        "0 worker-failed, 0 phantom, 0 lease-expired, 0 checklist-update-failed, 0 ignored",
    );
    expect(result.stdout).not.toContain("NEVER-DISPATCHED — ROUTE IT NOW");
    // The same witness, absent — proving this run attempted no post rather than merely printing less. It is
    // what makes "settles nothing" evidence: the finalisation door was never reached.
    expect(`${result.stdout}${result.stderr}`).not.toContain("could not finalise its indicators");
    // And nothing was written: the fixture's two rows, unchanged.
    const kinds = readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toEqual(["captured", "checklist-posted"]);
  });
});
