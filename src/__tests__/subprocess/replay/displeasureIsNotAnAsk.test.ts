/**
 * REPLAY LANE — the second half of the monitor failure, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/displeasure-dispatched-as-an-ask-1sep`) is that ask's own record set,
 * frozen through its `checklist-posted` event: the state at the moment BEFORE the defect fired. What
 * happened next is the incident — the loop judged a complaint quoting the bot's own last answer as
 * `respond`/`fresh-visible-session` and spent a whole new Opus worker guessing at a diagnosis the owner was
 * holding. The two withheld events, `dispatched` and everything after, ARE the defect.
 *
 * This runs the REAL `turn brief` over that frozen home. `turn brief` builds its brief from flags and reads
 * only — no socket, no Slack, no world model — so the shipped judging surface is what is under test rather
 * than a restatement of it.
 *
 * Two files the fixture deliberately does not carry are written by the test. `responders.json` holds a real
 * Slack id and is excluded from every freeze, so the gate refuses every identity without it; and the
 * addressing text is blanked by the freeze allowlist, because a colleague's message is exactly the content
 * class it exists to drop (`live/turn/freeze/redact.ts`). The fixture supplies the STRUCTURE — the ask's
 * lifecycle rows, its started-checklist ref, its ids — and the test supplies the text as a literal, the way
 * `workerGroundingRefused.test.ts` supplies the answer its worker composed.
 *
 * The witness is falsifiable: the same replay with the quote removed must print no STOP block at all, and
 * that case runs here too.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "displeasure-dispatched-as-an-ask-1sep";

/** The owner's reply, with the bot's own sentence quoted back — blanked by the freeze, so the test carries it. */
const DISPLEASURE =
  "> the monitors are not deployed ... these charts are a replay of the pr queries and thresholds over real " +
  "cost data @(UFIXTUREAC) thanks for nothing";

/** The same message with the quote dropped — the counter-case that must NOT trip the STOP. */
const NO_QUOTE = "the monitors are not deployed and these charts are a replay @(UFIXTUREAC) can you redo it";

let workspace: string;
let home: string;
let ask: { channel: string; messageTs: string; threadTs: string; askedBy: string };

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-displeasure-"));
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
    // The replay runs under vitest, not inside a visible session, so the host cannot be detected and
    // `turn brief` refuses rather than guessing. Naming it is what the flag exists for.
    "--host",
    "claude-code",
    "--force",
  ];
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

describe("the displeasure turn, replayed through the shipped judging surface", () => {
  it("now STOPS the judging session before any tier reasoning, where it dispatched an Opus worker", () => {
    const { status, stdout } = briefOn({ text: DISPLEASURE });

    expect(status).toBe(0);
    expect(stdout).toContain('THIS QUOTES SOMETHING BACK AND SAYS "thanks for nothing" — STOP');
  });

  it("says what is owed instead, in place of a fresh investigation", () => {
    const { stdout } = briefOn({ text: DISPLEASURE });

    expect(stdout).toContain("Check FIRST whether that line is this bot's own last answer in this thread");
    expect(stdout).toContain("No apology without an artefact");
  });

  it("prints nothing of the kind for the same complaint without a quote — the witness can fail", () => {
    const { stdout } = briefOn({ text: NO_QUOTE });

    expect(stdout).toContain("TURN ROUTING BRIEF");
    expect(stdout).not.toContain("STOP, do not dispatch an investigation");
  });
});
