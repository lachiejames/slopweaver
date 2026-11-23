/**
 * BLOCKED ON THE OWNER, end to end against the SHIPPED binary — the whole state, in one throwaway home.
 *
 * The design is five surfaces and one feature, and four of them are
 * exercised here by the real verbs rather than restated: the ask goes NOT DONE and stays that way, the live
 * card's last step wears the hourglass with no failure look, the block is listed for the fleet briefing to
 * card, `turn answer` REFUSES to post over it, and `turn unblock` makes the same turn resumable.
 *
 * ## Why it can run with no Slack at all, and what that proves rather than papers over
 *
 * `HOME` is the throwaway directory, so no bot token is reachable and every Slack write is refused before it
 * is attempted. That is the point rather than a limitation: `turn block` records the durable event FIRST and
 * reports the two Slack halves it could not do, so this run proves the exact ordering the feature's honesty
 * depends on — an ask whose card could not be edited and whose tag could not be posted is still, in the log,
 * a turn that is not done.
 *
 * **The falsifiable witness for "a Slack write was attempted".** Both halves print
 * `no Slack bot token is configured` when, and only when, they reach the point of needing one. Their
 * presence proves the arms ran; the `--dry-run` case below asserts the same lines are ABSENT, which is what
 * makes the witness a witness rather than a line that is always there.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absentAsNumber } from "#lib/absent.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const CHANNEL = "C_BLOCKED_PROOF";
const MESSAGE_TS = "1788800000.000100";
const ASKER = "U_ASKER_PROOF";
const QUESTION = "hey can you deploy the p99 latency monitor for checkout?";
const WHAT = "sign in to Google Cloud locally so the monitor can deploy";

let workspace: string;
let home: string;
let briefPath: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-blocked-on-human-"));
  home = join(workspace, "home");
  mkdirSync(home, { recursive: true });
  // A real responder whitelist rather than the break-glass: the gate is what every entrance checks first,
  // and running these verbs behind an override would prove less than running them the way the bot does.
  writeFileSync(join(home, "responders.json"), JSON.stringify([ASKER, "U_OWNER_PROOF"]), "utf8");
  briefPath = join(workspace, "brief.json");
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the throwaway home, with an environment carrying none of this machine's
 * real config.
 *
 * The home carries a real `responders.json`, written in `beforeEach` — an absent list refuses everyone at
 * every entrance, and going through the real gate is worth more here than the break-glass would be.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, [...args, "--home", home], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: "blocked-on-human-proof",
      HOME: workspace,
      SLOPWEAVER_CLI_DIR: repoRoot,
      SLOPWEAVER_HOME: home,
    },
  });
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** Every ask-lifecycle line this home has recorded, decoded. */
function lifecycleKinds(): readonly string[] {
  const path = join(home, "live", "slack", "asks.jsonl");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => String((JSON.parse(line) as { kind: unknown }).kind));
}

/** Write the brief a real `turn brief` run produced, and open the ask's lifecycle with a `captured` event. */
function briefTheAsk(): void {
  const brief = runSlopweaver({
    args: [
      "turn",
      "brief",
      "--channel",
      CHANNEL,
      "--message-ts",
      MESSAGE_TS,
      "--thread-ts",
      MESSAGE_TS,
      "--user",
      ASKER,
      "--text",
      QUESTION,
      "--turn-id",
      "turn-blocked-proof",
      "--working-ts",
      "1788800000.000150",
      "--out",
      briefPath,
    ],
  });
  expect(brief.status).toBe(0);
  expect(existsSync(briefPath)).toBe(true);
}

describe("a bot turn blocked on the owner, driven by the real verbs", () => {
  it("records the block, shows what it could not post, and leaves the ask NOT done", () => {
    briefTheAsk();
    const blocked = runSlopweaver({
      args: ["turn", "block", "--brief", briefPath, "--need", "sign-in", "--what", WHAT],
    });
    expect(blocked.status).toBe(0);
    expect(blocked.stdout).toContain(`${CHANNEL}/${MESSAGE_TS} is waiting on the owner — ${WHAT}`);
    // Both witnesses fire: the arms ran and reached the point of needing a token.
    expect(blocked.stderr).toContain("the card was not advanced — no Slack bot token is configured");
    expect(blocked.stderr).toContain("the in-thread tag was not posted — no Slack bot token is configured");
    expect(lifecycleKinds()).toContain("blocked-on-human");
    // The three terminal kinds, none of which this ask may have reached.
    for (const terminal of ["answered", "triaged-no-response", "withheld"]) {
      expect(lifecycleKinds()).not.toContain(terminal);
    }
  });

  it("dry-runs the hourglass frame without recording or attempting anything", () => {
    briefTheAsk();
    const before = lifecycleKinds();
    const dry = runSlopweaver({
      args: ["turn", "block", "--brief", briefPath, "--need", "sign-in", "--what", WHAT, "--dry-run"],
    });
    expect(dry.status).toBe(0);
    const frame = JSON.parse(dry.stdout.slice(0, dry.stdout.lastIndexOf("}") + 1)) as {
      steps: readonly { state: string; title: string; children?: readonly string[] }[];
    };
    expect(frame.steps.map((step) => step.state)).toEqual(["done", "blocked"]);
    expect(frame.steps[1]!.title).toBe(`Waiting on the owner: ${WHAT}`);
    expect(frame.steps[1]!.children).toEqual(["waiting on the owner to sign in — picking straight back up once it is"]);
    // The witness is absent, which is what makes its presence above evidence rather than noise.
    expect(dry.stderr).not.toContain("no Slack bot token is configured");
    expect(lifecycleKinds()).toEqual(before);
  });

  it("lists it for the fleet briefing, with the permalink token a card has to link", () => {
    briefTheAsk();
    runSlopweaver({ args: ["turn", "block", "--brief", briefPath, "--need", "sign-in", "--what", WHAT] });
    const listed = runSlopweaver({ args: ["turn", "blocked", "--json"] });
    expect(listed.status).toBe(0);
    const rows = JSON.parse(listed.stdout) as readonly Record<string, string>[];
    expect(rows.length).toBe(1);
    expect(rows[0]!["standing"]).toBe("waiting");
    expect(rows[0]!["need"]).toBe("sign-in");
    expect(rows[0]!["what"]).toBe(WHAT);
    expect(rows[0]!["permalinkToken"]).toBe("p1788800000000100");
  });

  it("refuses to post a final answer over it — the ask is not done, and is not ticked off", () => {
    briefTheAsk();
    runSlopweaver({ args: ["turn", "block", "--brief", briefPath, "--need", "sign-in", "--what", WHAT] });
    // The answer and decision files are never read: the refusal is deliberately ahead of both parses,
    // because a turn that must not post has no business being told its form is malformed first.
    const answerPath = join(workspace, "answer.json");
    const decisionPath = join(workspace, "decision.json");
    writeFileSync(answerPath, "{}", "utf8");
    writeFileSync(decisionPath, "{}", "utf8");
    const answered = runSlopweaver({
      args: ["turn", "answer", "--brief", briefPath, "--answer", answerPath, "--decision", decisionPath],
    });
    expect(answered.status).not.toBe(0);
    expect(answered.stderr).toContain("is still waiting on the owner");
    expect(answered.stderr).toContain("slopweaver turn unblock");
    expect(lifecycleKinds()).not.toContain("answered");
  });

  it("becomes resumable the moment the owner has done it, and says how to resume", () => {
    briefTheAsk();
    runSlopweaver({ args: ["turn", "block", "--brief", briefPath, "--need", "sign-in", "--what", WHAT] });
    const unblocked = runSlopweaver({
      args: ["turn", "unblock", "--channel", CHANNEL, "--message-ts", MESSAGE_TS, "--note", "signed in"],
    });
    expect(unblocked.status).toBe(0);
    expect(unblocked.stdout).toContain("is moving again — signed in");
    expect(unblocked.stdout).toContain("slopweaver turn dispatch --brief");
    expect(lifecycleKinds()).toContain("unblocked");

    const listed = runSlopweaver({ args: ["turn", "blocked", "--json"] });
    const rows = JSON.parse(listed.stdout) as readonly Record<string, string>[];
    expect(rows.length).toBe(1);
    expect(rows[0]!["standing"]).toBe("ready-to-resume");
    expect(rows[0]!["clearedNote"]).toBe("signed in");
    expect(rows[0]!["what"]).toBe(WHAT);
  });

  it("refuses an unblock for an ask nothing is waiting on", () => {
    briefTheAsk();
    const unblocked = runSlopweaver({
      args: ["turn", "unblock", "--channel", CHANNEL, "--message-ts", MESSAGE_TS, "--note", "signed in"],
    });
    expect(unblocked.status).not.toBe(0);
    expect(unblocked.stderr).toContain("is not waiting on the owner");
    expect(lifecycleKinds()).not.toContain("unblocked");
  });
});
