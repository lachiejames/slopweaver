/**
 * REPLAY LANE — the real-world tagging dogfood, tag 2 (a real public-channel ask).
 *
 * The fixture (`fixtures/replay/validate-refusal-finalised`) is that ask's own record set, frozen through
 * its `dispatched` event: the exact state the machine was in before the worker composed its answer. What
 * happened next is the incident — the worker's first answer was over the count/aggregate cap, and
 * `turn resume --answer` wrote the SAME durable, sweep-finalised FAILED marker a worker's own considered
 * `--failed` give-up writes. The loop's sweep finalised the ask and told the owner to re-tag while the
 * worker was still alive, trimmed its answer, and opened a reviewer — the split this fixture exists to catch.
 *
 * This runs the REAL `turn resume --dispatch <id> --answer <path>` over that frozen decision, first with an
 * over-cap answer, then with it trimmed, proving both halves of the fix: the refusal fires from the worker's
 * own validate step (never reaching a Slack post), and it is RETRYABLE rather than terminal, because it
 * writes no durable marker at all.
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
const SLUG = "validate-refusal-finalised";

/** The decision's own capability id, carried through freeze unredacted because a replay assertion reads it. */
const CAPABILITY_ID = "github-live-detail";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-validate-refused-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment that carries none of
 * this machine's real config — the break-glass env var included, so a passing test proves the cap actually
 * refuses rather than the var being accidentally inherited from this machine's own shell.
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

/** One short, valid paragraph block — used to build a body either under or over `BODY_MAX_BLOCKS` (12). */
function paragraph({ text }: { text: string }): {
  readonly runs: readonly { text: string; type: "text" }[];
  readonly type: "paragraph";
} {
  return { runs: [{ text, type: "text" }], type: "paragraph" };
}

/** The grounding both answers share — satisfies the frozen decision's own required `github-live-detail` need. */
const GROUNDING = {
  capability: { command: ["github", "pr", "list"], id: CAPABILITY_ID, what: "the ten bump PRs" },
  evidence: {
    consultedEmpty: [],
    couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
    premiseChecks: [],
    read: [],
  },
  kind: "verb" as const,
  provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
  result: "10 bump PRs checked",
};

/** 13 body blocks — one over `BODY_MAX_BLOCKS` — the exact shape of refusal the incident's worker hit. */
const OVER_CAP_ANSWER = {
  body: Array.from({ length: 13 }, (_, index) => paragraph({ text: `PR ${index + 1}: notify team X` })),
  citations: [],
  grounding: GROUNDING,
  images: [],
  kind: "answer",
  lead: "10 bump PRs, notify targets below",
};

/** The same answer, trimmed to fit under the cap — the worker's own recovery, no new investigation needed. */
const TRIMMED_ANSWER = { ...OVER_CAP_ANSWER, body: OVER_CAP_ANSWER.body.slice(0, 12) };

/**
 * Materialise the fixture and reset it to the moment right after `dispatched`, before any answer was ever
 * attempted — matching `worker-grounding-refused-29aug`'s own replay: the real incident kept running after
 * the freeze, so the durable turn-marker file this ask carries on disk is captured at freeze time regardless
 * of `--through dispatched` excluding it from the lifecycle log. Clearing it is what makes "no marker yet"
 * the correct starting state for a scenario about the FIRST validate attempt.
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

describe("replay: validate-refusal-finalised", () => {
  it("refuses an over-cap answer non-terminally — no SLOPWEAVER_TURN_FAILED, no durable marker", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, JSON.stringify(OVER_CAP_ANSWER), "utf8");

    const result = runSlopweaver({
      args: ["turn", "resume", "--dispatch", dispatchId, "--answer", answerPath, "--home", home],
    });

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    // The refusal names what it MEASURED against which limit, not just that a cap exists: the incident's
    // worker had to grep `BODY_MAX_BLOCKS` out of `answerForm.ts` mid-turn to learn the number it broke.
    expect(output).toContain("13 body blocks against the BODY_MAX_BLOCKS limit of 12");
    expect(output).toContain("this is not a terminal failure");
    // Never the terminal marker: a compose-time refusal must not read as the same give-up a considered
    // `--failed` writes, or the loop's sweep finalises the ask before the worker can fix it — the exact
    // defect this fixture was frozen to catch.
    expect(output).not.toContain("SLOPWEAVER_TURN_FAILED");
    expect(readCurrentGenerationTurnMarker({ askIdentity, home })).toBeUndefined();
  });

  it("recovers when the SAME worker trims the SAME answer and re-runs the exact same command", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, JSON.stringify(OVER_CAP_ANSWER), "utf8");
    const first = runSlopweaver({
      args: ["turn", "resume", "--dispatch", dispatchId, "--answer", answerPath, "--home", home],
    });
    expect(first.status).not.toBe(0);

    writeFileSync(answerPath, JSON.stringify(TRIMMED_ANSWER), "utf8");
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
