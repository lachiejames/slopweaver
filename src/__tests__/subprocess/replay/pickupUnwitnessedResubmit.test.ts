/**
 * REPLAY LANE — the stranded-pickup incident, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/pickup-unwitnessed-2sep`) is that ask's own record set, frozen THROUGH its
 * `dispatch-unwitnessed` event: the exact state `cmux spawn` left behind when it typed the pickup line into
 * workspace:979, spent its whole 30-tick witness budget seeing nothing, and gave up. The two events after it
 * are withheld, and they are the incident's cost — `dispatch-witnessed` did not arrive until 05:15:40.801Z,
 * **11 minutes 11 seconds later**, and only because a supervisor's sweep read cmux's own delivery record.
 * Nothing in band could act on the state this fixture holds.
 *
 * Sibling of `dispatchOrphanSweep.test.ts` and deliberately not a copy of it: that fixture is frozen at
 * `dispatched`, one event EARLIER, and asks whether the sweep abandons a worker whose pickup was never
 * witnessed. This one starts where that ends — the give-up is already on the record — and asks the question
 * the fix turns on: does an ask whose spawn ran out of witnesses stay a tracked, live worker? It must, because
 * `cmux/pickupWitnessWindow.ts`'s `resubmitPickupThenWitness` now submits that session's composer a second time and keeps
 * watching, and a sweep that had meanwhile written the ask off would be racing its own remedy.
 *
 * Run with cmux UNREACHABLE, which is the hard case: a broken oracle must never be read as a dead worker.
 *
 * **The falsifiable witness for "nothing was posted"** is `settleSweptTerminal`'s own line — with no bot
 * token configured, finalising a swept ask prints `could not finalise its indicators — no Slack bot token is
 * configured`, which appears when and only when a post was ATTEMPTED. Its absence is evidence rather than
 * silence.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-pickup-unwitnessed-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config: `HOME` is the throwaway directory, and `CMUX_SOCKET_PATH` names a socket that does
 * not exist, so every cmux read fails the way it does when the daemon is gone.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  // `spawnSync`, not `execFileSync`: on a ZERO-exit run `execFileSync` returns stdout alone and lets stderr
  // through to the parent, so an assertion that a stderr line is ABSENT would pass because it could never
  // have seen the line in the first place. This whole file's second test turns on that line, so the runner
  // has to capture both streams whatever the status.
  const run = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"),
      HOME: workspace,
      PATH: process.env["PATH"]!,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: absentAsNumber({ value: run.status, whenAbsent: 1 }), stderr: run.stderr, stdout: run.stdout };
}

describe("replay: pickup-unwitnessed-2sep", () => {
  it("keeps a dispatch the spawn gave up witnessing as a live, NAMED worker", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "pickup-unwitnessed-2sep" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `still working: ${manifest.ask.channel}/${manifest.ask.messageTs} — worker ask-${manifest.ask.channel}-${manifest.ask.messageTs} (workspace:979)`,
    );
    expect(result.stdout).toContain(
      "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
  });

  it("finalises nothing and posts nothing over an ask whose pickup went unwitnessed", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "pickup-unwitnessed-2sep" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });

    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain("could not finalise its indicators");
    expect(output).not.toContain("phantom (nothing running");
    expect(output).not.toContain("lease-expired (re-judgement candidate)");
  });

  it("proves that witness can fire, by running the SAME replay past the dispatch's lease", { timeout: 60_000 }, () => {
    // The absence asserted above is only evidence if the line is reachable at all. Same fixture, same verb,
    // one field changed — a clock past `leaseExpiresAt` — and both the terminal finding and the finalisation
    // attempt appear. Without this, "nothing was posted" would be an assertion about silence.
    materialiseFixture({ into: home, slug: "pickup-unwitnessed-2sep" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", "2026-09-02T09:00:00.000Z"],
    });

    expect(result.stdout).toContain("lease-expired (re-judgement candidate)");
    expect(result.stderr).toContain("could not finalise its indicators — no Slack bot token is configured");
  });

  it("is frozen AT the give-up, and names the reconciliation it withheld", () => {
    const manifest = materialiseFixture({ into: home, slug: "pickup-unwitnessed-2sep" });

    expect(manifest.through).toBe("dispatch-unwitnessed");
    // Both withheld events are what the incident cost: the ask reached neither for eleven more minutes, and
    // it took a human-driven sweep rather than anything the spawn itself could do.
    expect(manifest.withheldEventKinds).toEqual(["dispatch-witnessed", "answered"]);
  });
});
