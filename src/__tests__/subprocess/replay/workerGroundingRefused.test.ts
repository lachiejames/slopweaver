/**
 * REPLAY LANE — the dogfood tag incident, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/worker-grounding-refused-29aug`) is that ask's own record set, frozen
 * through its `dispatched` event: the exact state the machine was in before the worker composed its answer.
 * What happened next is the incident — a full opus investigation grounded its answer on the
 * `slack-read-thread` verb (never a routable capability on any brief), and `turn resume --answer` wrote the
 * SAME durable, sweep-finalised FAILED marker a worker's own considered `--failed` give-up writes, so the
 * loop's sweep finalised the ask before the worker had any chance to fix the one field and retry.
 *
 * This runs the REAL `turn resume --dispatch <id> --answer <path>` over that frozen decision, first with the
 * exact grounding the incident's worker wrote, then with it corrected — proving both halves of the fix: the
 * refusal fires from the worker's own validate step (never reaching a Slack post), and it is RETRYABLE
 * rather than terminal, because it writes no durable marker at all.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../live/ask/identity.js";
import { dispatchIdOf } from "../../../live/turn/dispatch.js";
import { readCurrentGenerationTurnMarker, turnMarkerPath } from "../../../live/turn/turnMarkerStore.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "worker-grounding-refused-29aug";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-grounding-refused-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment that carries none of
 * this machine's real config.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: workspace,
      encoding: "utf8",
      env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

/** The answer the incident's worker actually composed — grounded on reading the thread, not on a capability. */
const THREAD_READ_ANSWER = {
  body: [{ runs: [{ text: "the merge-queue eviction split", type: "text" }], type: "paragraph" }],
  citations: [],
  grounding: {
    capability: { command: ["private-cli", "slack", "read-thread"], id: "slack-read-thread", what: "the thread" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
    },
    kind: "verb",
    provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
    result: "read the thread",
  },
  images: [],
  kind: "answer",
  lead: "here is the split",
};

/** The same answer, corrected to ground on the capability the decision actually named. */
const TELEMETRY_ANSWER = {
  ...THREAD_READ_ANSWER,
  grounding: {
    ...THREAD_READ_ANSWER.grounding,
    capability: { command: ["private-cli", "telemetry", "query"], id: "telemetry", what: "merge-queue evictions" },
  },
};

/**
 * Materialise the fixture and reset it to the moment right after `dispatched`, before any answer was ever
 * attempted. The real incident this fixture was frozen from kept running after the freeze (it later
 * recovered and answered), so the durable turn-marker file this ask carries on disk is the incident worker's
 * OWN stale "failed" state from a point chronologically AFTER `dispatched` — the lifecycle log excludes it
 * (`--through dispatched`), but the sibling marker file is captured at freeze time regardless. Clearing it is
 * what makes "no marker yet" the correct starting state for a scenario about the FIRST validate attempt.
 *
 * @param into the throwaway home to materialise into
 * @returns the fixture's manifest and the ask identity/dispatch id derived from it
 */
function materialiseAtDispatch({ into }: { into: string }): {
  readonly askIdentity: AskIdentity;
  readonly dispatchId: string;
} {
  const manifest = materialiseFixture({ into, slug: SLUG });
  const askIdentity = {
    channel: manifest.ask.channel,
    messageTs: manifest.ask.messageTs,
    threadTs: manifest.ask.threadTs,
  };
  const markerPath = turnMarkerPath({ askIdentity, home: into });
  if (existsSync(markerPath)) {
    rmSync(markerPath);
  }
  return { askIdentity, dispatchId: dispatchIdOf({ askIdentity }) };
}

describe("replay: worker-grounding-refused-29aug", () => {
  it("refuses the incident's own thread-read grounding, non-terminally, naming the allowed ids", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, JSON.stringify(THREAD_READ_ANSWER), "utf8");

    const result = runSlopweaver({
      args: ["turn", "resume", "--dispatch", dispatchId, "--answer", answerPath, "--home", home],
    });

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("slack-read-thread");
    expect(output).toContain("telemetry");
    expect(output).toContain("investigation, never grounding");
    // Never the terminal marker: the worker's own compose-time refusal must not read as the same give-up a
    // considered `--failed` writes, or the loop's sweep finalises the ask before the worker can fix it.
    expect(output).not.toContain("SLOPWEAVER_TURN_FAILED");
    expect(readCurrentGenerationTurnMarker({ askIdentity, home })).toBeUndefined();
  });

  it("recovers when the SAME worker fixes the grounding and re-runs the exact same command", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, JSON.stringify(THREAD_READ_ANSWER), "utf8");
    const first = runSlopweaver({
      args: ["turn", "resume", "--dispatch", dispatchId, "--answer", answerPath, "--home", home],
    });
    expect(first.status).not.toBe(0);

    writeFileSync(answerPath, JSON.stringify(TELEMETRY_ANSWER), "utf8");
    const second = runSlopweaver({
      args: ["turn", "resume", "--dispatch", dispatchId, "--answer", answerPath, "--home", home],
    });

    expect(second.status).toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain("SLOPWEAVER_TURN_READY");
    expect(readCurrentGenerationTurnMarker({ askIdentity, home })?.kind).toBe("ready");
  });

  it("froze through dispatched, withholding the incident's own failed event", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.withheldEventKinds).toEqual(["failed", "answered"]);
  });
});
