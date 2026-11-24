/**
 * REPLAY LANE — an independent freeze of the "thanks for nothing" dismissal, cut at an earlier
 * point than `displeasureIsNotAnAsk.test.ts`'s fixture.
 *
 * That sibling test replays the same ask through its home frozen `--through checklist-posted` — the state
 * right before the loop dispatched a fresh Opus worker to re-investigate. This fixture
 * (`fixtures/replay/owner-dismissal-dispatched-as-ask`) freezes the SAME ask instead through `captured`,
 * the moment the reply first landed, before even a checklist was posted. `ownerDispleasure.ts`'s classifier
 * reads only the addressing text, not stored home state, so this proves the STOP fires from the very first
 * moment the message is judged — not only once other turn machinery has already run.
 *
 * This runs the REAL `turn brief` over that frozen home, the same way its sibling does.
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
const SLUG = "owner-dismissal-dispatched-as-ask";

/** The owner's reply, with the bot's own sentence quoted back — blanked by the freeze, so the test carries it. */
const DISMISSAL =
  "> the monitors are not deployed ... these charts are a replay of the pr's queries and thresholds over " +
  "real cost data @(UFIXTUREAC) thanks for nothing";

let workspace: string;
let home: string;
let ask: { channel: string; messageTs: string; threadTs: string; askedBy: string };

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-dismissal-"));
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

describe("the dismissal turn, replayed from its earliest frozen point", () => {
  it("STOPS the judging session before any tier reasoning", () => {
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
