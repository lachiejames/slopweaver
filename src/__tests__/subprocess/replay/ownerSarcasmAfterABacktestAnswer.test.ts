/**
 * REPLAY LANE — the FIRST half of the monitor-backtest incident: the original turn that drew the
 * owner's "thanks for nothing" reply, frozen whole (not `--through`) because its subject is the composed
 * answer and its terminal `answered` event, not a bad event a later verb misread.
 *
 * `displeasureIsNotAnAsk.test.ts` and `ownerDismissalDispatchedAsAsk.test.ts` both replay the DISMISSAL
 * turn itself. This fixture (`fixtures/replay/owner-sarcasm-after-a-backtest-answer`) holds no dismissal
 * ask at all — only the original, already-answered one. `ownerDispleasure.ts`'s classifier reads only the
 * addressing text passed to `turn brief`, never stored home state (see its module header), so briefing on
 * this home with the same quoting-and-complaint text the owner actually sent proves the STOP is not an
 * artefact of the dismissal fixture's own frozen rows — it fires from the addressing text alone, even over a
 * home whose only recorded turn is the complete, delivered original.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "owner-sarcasm-after-a-backtest-answer";

/** The owner's reply, with the bot's own sentence quoted back — blanked by the freeze, so the test carries it. */
const DISMISSAL =
  "> the monitors are not deployed ... these charts are a replay of the pr's queries and thresholds over " +
  "real cost data @(UFIXTUREAC) thanks for nothing";

let workspace: string;
let home: string;
let ask: { channel: string; messageTs: string; threadTs: string; askedBy: string };

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-sarcasm-"));
  home = join(workspace, "home");
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  ask = manifest.ask;
  writeFileSync(join(home, "responders.json"), JSON.stringify([ask.askedBy]), "utf8");
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config.
 *
 * @param text the addressing message to brief on
 * @returns the exit status and both streams
 */
function briefOn({ text }: { text: string }): { status: number; stdout: string; stderr: string } {
  const args = [
    "turn",
    "brief",
    "--channel",
    ask.channel,
    "--message-ts",
    ask.messageTs,
    "--thread-ts",
    ask.threadTs,
    "--user",
    ask.askedBy,
    "--text",
    text,
    "--home",
    home,
    "--host",
    "claude-code",
    "--force",
  ];
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

describe("the original backtest turn, replayed with the reply it drew", () => {
  it("STOPS the judging session before any tier reasoning, over a home holding only the completed original turn", () => {
    const { status, stdout } = briefOn({ text: DISMISSAL });

    expect(status).toBe(0);
    expect(stdout).toContain('THIS QUOTES SOMETHING BACK AND SAYS "thanks for nothing" — STOP');
  });

  it("says what is owed instead, in place of a fresh investigation", () => {
    const { stdout } = briefOn({ text: DISMISSAL });

    expect(stdout).toContain("Check FIRST whether that line is this bot's own last answer in this thread");
    expect(stdout).toContain("No apology without an artefact");
  });
});
