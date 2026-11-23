/**
 * REPLAY LANE — the dispatch-orphan incident, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/dispatch-orphan-28aug`) is that ask's own record set, frozen through its
 * `dispatched` event: the exact state the machine was in the moment before the pickup witness failed. What
 * happened next is the incident — the dispatch was recorded `dispatch-failed`, the live worker vanished from
 * `--sweep`, the card was finalised abandoned and a ⚠️ went up in a teammate's thread for forty minutes.
 *
 * This runs the real `turn dispatch --sweep` over that state with cmux UNREACHABLE, which is the hard case:
 * a broken oracle must never be read as a dead worker. Three assertions, and the third is the one that would
 * have caught the incident.
 *
 * **The falsifiable witness for "nothing was posted".** `settleSweptTerminal` finalises a swept ask's
 * indicators, and with no bot token configured that finalisation prints
 * `could not finalise its indicators — no Slack bot token is configured` — a line that appears when, and only
 * when, a post was ATTEMPTED. Its absence is therefore evidence rather than silence, and the same witness
 * the original gold proof used.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-dispatch-orphan-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment that carries none of
 * this machine's real config: `HOME` is the throwaway directory, and `CMUX_SOCKET_PATH` points at a socket
 * that does not exist, so every cmux read fails the way it does when the daemon is gone.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  // `spawnSync`, not `execFileSync`: on a ZERO-exit run `execFileSync` returns stdout alone and lets stderr
  // through to the parent untouched, so this file's "nothing was posted" assertion could not have seen the
  // finalisation line even if it had been printed — an absence check over a stream that was never captured.
  const run = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: absentAsNumber({ value: run.status, whenAbsent: 1 }), stderr: run.stderr, stdout: run.stdout };
}

describe("replay: dispatch-orphan-28aug", () => {
  it("sweeps the frozen dispatch as still working, and finalises nothing", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "dispatch-orphan-28aug" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.status).toBe(0);
    // The worker is NAMED, which is the half that matters: an unreachable oracle left the ask reported as
    // running against the workspace its record points at, rather than silently counted and unaddressable.
    expect(result.stdout).toContain(
      `still working: ${manifest.ask.channel}/${manifest.ask.messageTs} — worker ask-${manifest.ask.channel}-${manifest.ask.messageTs} (workspace:399)`,
    );
    expect(result.stdout).toContain(
      "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
  });

  it("never posts the abandonment a failed witness used to raise", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "dispatch-orphan-28aug" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    const output = `${result.stdout}${result.stderr}`;
    // The witness described in this file's header: this line appears exactly when a finalisation was tried.
    expect(output).not.toContain("could not finalise its indicators");
    expect(output).not.toContain("phantom (nothing running");
    expect(output).not.toContain("lease-expired (re-judgement candidate)");
  });

  it("froze the state before the defect fired, and says which events it withheld", () => {
    const manifest = materialiseFixture({ into: home, slug: "dispatch-orphan-28aug" });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.withheldEventKinds).toEqual(["dispatch-failed", "failed"]);
  });
});
