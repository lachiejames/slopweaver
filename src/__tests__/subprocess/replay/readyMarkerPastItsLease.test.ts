/**
 * REPLAY LANE — the turn whose `ready` marker outranked its expired lease for good.
 *
 * The fixture (`fixtures/replay/ready-marker-past-its-lease-15sep`) is the SaaS-spend ask the owner paused
 frozen through its second `dispatched` event with its clock stopped at the sweep that
 * reported it. Its worker wrote a `ready` turn marker against a lease still running; round 3 of
 * its review returned `broken` and was released; nothing posted. At that sweep it printed
 * `0 lease-expired`, because `sweepDecision` returned `ready` before the lease was consulted — so the ask kept
 * its `activeDispatch`, and `session respawn loop` refused on "1 ask(s) is still in flight" with no way out.
 *
 * The cases drive the shipped `turn dispatch --sweep` over the frozen world, and read the respawn gate's own
 * in-flight count (`asksHoldingWorkers`) off the home before and after, which is the consequence the finding
 * named.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../live/ask/identity.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { asksHoldingWorkers } from "../../../live/standing/respawn.js";
import { reviewPostureOf } from "../../../live/turn/reviewPosture.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "ready-marker-past-its-lease-15sep";

/** The sweep that printed `0 lease-expired` over this ask — the fixture's own `replayNowIso`. */
const AT_THE_INCIDENT = "2026-09-15T03:37:00.000Z";

/** Inside the lease: the marker was written before this instant and the lease runs past it. */
const INSIDE_THE_LEASE = "2026-09-15T01:00:00.000Z";

/** The sweep's summary line when this home's one ask is abandoned on its lease. Asserted whole. */
const SWEEP_EXPIRED =
  "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 1 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored";

/** The same line while the ready marker still stands inside its lease. */
const SWEEP_READY =
  "sweep: 1 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-ready-lease-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, in an environment carrying none of this
 * machine's real config — no Slack token, and a cmux socket that does not exist.
 *
 * @param args the argv tail
 * @returns the exit status and both streams, already joined for assertion
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; output: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: workspace,
      encoding: "utf8",
      env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { output: stdout, status: 0 };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { output: `${e.stdout}${e.stderr}`, status: e.status };
  }
}

/** Materialise the fixture and hand back the ask every verb below is addressed by. */
function materialise(): AskIdentity {
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  return { channel: manifest.ask.channel, messageTs: manifest.ask.messageTs, threadTs: manifest.ask.threadTs };
}

/** Sweep the materialised home at one instant. */
function sweepAt({ nowIso }: { nowIso: string }): { status: number; output: string } {
  return runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", nowIso, "--home", home] });
}

/** How many asks `session respawn loop` would count as in flight in this home — its quiet-moment gate. */
function asksInFlight(): number {
  const lifecycles = [
    ...foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events }).values(),
  ];
  return asksHoldingWorkers({ isIgnored: () => false, lifecycles });
}

describe("replay: ready-marker-past-its-lease-15sep", () => {
  it("froze a ready marker inside the lease, a released broken review, and no ending", () => {
    const askIdentity = materialise();
    const manifest = materialiseFixture({ into: join(workspace, "manifest-read"), slug: SLUG });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.replayNowIso).toBe(AT_THE_INCIDENT);
    const marker = JSON.parse(
      readFileSync(
        join(home, "live/slack/turn-markers", `${askIdentity.channel}-${askIdentity.messageTs}.json`),
        "utf8",
      ),
    ) as { kind: string; leaseExpiresAt: string; recordedAtIso: string };
    expect(marker.kind).toBe("ready");
    expect(marker.recordedAtIso).toBe("2026-09-15T00:38:47.467Z");
    expect(marker.leaseExpiresAt).toBe("2026-09-15T01:57:14.109Z");
    // Nothing holds the clock: the review record is released and its last round is not a usable verdict.
    expect(reviewPostureOf({ askIdentity, home })).toEqual({
      hasUsableVerdict: false,
      inFlight: false,
      recordOpen: false,
      spawnedAt: "2026-09-15T00:39:52.771Z",
    });
    expect(asksInFlight()).toBe(1);
  });

  it("still reports the ready marker as ready inside its lease", () => {
    materialise();
    expect(sweepAt({ nowIso: INSIDE_THE_LEASE }).output).toContain(SWEEP_READY);
    expect(asksInFlight()).toBe(1);
  });

  it("abandons the turn on its lease at the incident instant, releasing the respawn gate", () => {
    // This used to print `1 ready … 0 lease-expired` and the ask held its dispatch forever.
    const askIdentity = materialise();
    const swept = sweepAt({ nowIso: AT_THE_INCIDENT });
    expect(swept.output).toContain(
      `lease-expired (re-judgement candidate): ${askIdentity.channel}/${askIdentity.messageTs}`,
    );
    expect(swept.output).toContain(SWEEP_EXPIRED);
    expect(asksInFlight()).toBe(0);
  });
});
