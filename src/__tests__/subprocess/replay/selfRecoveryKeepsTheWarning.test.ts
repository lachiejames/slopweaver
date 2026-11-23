/**
 * REPLAY LANE — the self-recovery, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/self-recovery-keeps-the-warning-18sep`) is that ask's own record set, frozen
 * through its LAST `dispatched` event — the re-dispatch at 06:19:51.314Z, seven minutes after a phantom
 * finding had correctly settled the tagged message to `:warning:`. `answered` is withheld, so this is the
 * exact 43-minute window in which a live worker's ask advertised itself to the asker as failed. The standing
 * rule: the warning reaction on the ask post goes back to the first emoji, eyes, once the self-recovery is in
 * progress.
 *
 * **The falsifiable witness, and why the line had to be shaped for it.** This fixture home carries no Slack
 * bot token, so nothing here can read or write a real reaction — and a line that only said "could not check"
 * would prove the assertion ran rather than proving what it decided. So `reactionAssertionLine` prints the
 * EXPECTATION it derived, which is derived from the frozen ledger alone: for this state it is `:eyes:`, and
 * it is exactly the value the old code had no way to compute at all. The absence check below is evidence for
 * the same reason — the fixture CARRIES a `dispatch-failed` row, so a sweep that still read this ask as
 * failed would name `:warning:` on that same line.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "self-recovery-keeps-the-warning-18sep";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-self-recovery-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config: `HOME` is the throwaway directory, and `CMUX_SOCKET_PATH` points at a socket that
 * does not exist, so every cmux read fails the way it does when the daemon is gone.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
    maxBuffer: 8 * 1024 * 1024,
  });
  // A `null` status means the child was KILLED by a signal rather than exiting, which is a different thing
  // from exiting 1 and is spelled out rather than folded into one with `??` — a failure we report as an
  // ordinary non-zero exit is a failure whose real cause the next reader has to rediscover.
  if (run.status === null) {
    return { status: 1, stderr: `${run.stderr}\nthe binary was killed by a signal, not exited`, stdout: run.stdout };
  }
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

describe(`replay: ${SLUG}`, () => {
  it("expects the CAPTURE emoji on the tag, because a worker holds the ask again", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.status).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain(`reaction: ${manifest.ask.channel}/${manifest.ask.messageTs} — expected :eyes: (working)`);
  });

  it("never expects the warning the frozen dispatch-failed row would once have earned", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    const output = `${result.stdout}${result.stderr}`;
    // The input CARRIES the failure this calls absent — `asks.jsonl` holds the 06:12:14.344Z
    // `dispatch-failed` row — so this is a check on the decision, not on silence.
    expect(output).not.toContain("expected :warning:");
  });

  it("still sweeps the re-dispatched worker as running, so the assertion cost it nothing", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.stdout).toContain(
      "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
  });

  it("froze the state at the self-recovery, and says which event it withheld", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.withheldEventKinds).toEqual(["answered"]);
    expect(manifest.replayNowIso).toBe("2026-09-18T06:19:51.314Z");
  });
});
