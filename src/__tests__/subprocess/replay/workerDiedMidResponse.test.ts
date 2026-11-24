/**
 * REPLAY LANE — the turn that died mid-response, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/worker-died-mid-response-10sep`) is that ask's own record set, frozen
 * `--not-after` the instant the worker's session died with `API Error: Connection
 * lost mid-response`, 49 minutes and 61 tool calls in, one line after writing that reviewer round 2 had
 * found a real error in its cross-service claim. It carries exactly what the machine held at that moment:
 * two completed review rounds, and NO draft answer, because the draft lived at a worker-chosen scratchpad
 * path that no longer exists.
 *
 * The incident is that all of it was unreachable. The verdicts had been on disk for a while and
 * nothing outside a review round had ever read one back, so the session that picked the ask up afterwards
 * re-investigated from nothing and only answered much later. This runs the REAL
 * `turn resume --dispatch <id>` — the first command any fresh worker on this ask runs — and asserts it now
 * hands that work forward.
 *
 * ## The falsifiable witness
 *
 * The `RESUMING FROM CHECKPOINT` block is printed only when the record set holds something to resume from,
 * so its presence is the witness and the assertions turn on CONTENT the fixture actually carries: two
 * rounds, each at the spawn instant its own archive filename encodes, each with the supported-claim count
 * its own verdict document holds. The counter-case is the SAME fixture with its review directory removed —
 * which is what a turn that died before its first reviewer really looks like — and it must print no block
 * at all, which is what shows the witness can fail.
 *
 * The draft line is the incident stated as an assertion rather than as prose: over this record set the verb
 * says there is no draft, because there genuinely never was one anything could read. What closes that half
 * is the checkpoint `turn resume --answer` writes from now on (`live/turn/checkpointStore.ts`), which no
 * fixture frozen before it existed can carry.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "worker-died-mid-response-10sep";

let workspace: string;
let home: string;
let dispatchId: string;
let reviewDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-died-mid-response-"));
  home = join(workspace, "home");
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  dispatchId = JSON.stringify([manifest.ask.channel, manifest.ask.messageTs, manifest.ask.threadTs]);
  reviewDir = join(home, "live", "slack", "reviews", `${manifest.ask.channel}-${manifest.ask.messageTs}`);
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
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
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("the turn that died mid-response, replayed through the shipped binary", () => {
  it("hands a fresh session both review rounds the dead one paid for, oldest first", () => {
    const { status, stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(status).toBe(0);
    expect(stdout).toContain("RESUMING FROM CHECKPOINT");
    expect(stdout).toContain("rounds: 2 already returned a verdict");
    expect(stdout).toContain("round 1 (2026-09-10T13:34:39.172Z)");
    expect(stdout).toContain("round 2 (2026-09-10T13:50:07.477Z)");
  });

  it("names what each round settled and what it left standing, so round 3 does not re-litigate them", () => {
    const { stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(stdout).toContain("outcome broken, bound to answer digest sha256:c73ef2b7");
    expect(stdout).toContain("outcome broken, bound to answer digest sha256:2e281c14");
    expect(stdout).toContain("settled: 8 claim(s) this reviewer verified — do not re-verify them");
    expect(stdout).toContain("left standing, and a re-run must NOT carry these forward as written:");
    expect(stdout).toContain("[high impact, unsupported]");
  });

  it("says the draft is gone rather than naming a path nothing can open — the incident itself", () => {
    const { stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(stdout).toContain("draft: none — no answer of that session's ever passed validate");
  });

  it("prints no checkpoint block at all over the same turn with no rounds — the witness can fail", () => {
    rmSync(reviewDir, { force: true, recursive: true });

    const { status, stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(status).toBe(0);
    expect(stdout).toContain("You own this ask to its terminal outcome");
    expect(stdout).not.toContain("RESUMING FROM CHECKPOINT");
  });
});
