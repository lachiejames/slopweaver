/**
 * REPLAY LANE — the monitor-backtest incident, re-run against the SHIPPED binary.
 *
 * The fixture (`fixtures/replay/generated-charts-no-skill-1sep`) is that ask's own record set, frozen
 * through its `dispatch-witnessed` event: the exact state the machine was in as the worker picked its brief
 * up. What happened next is the incident — the worker answered a Datadog-monitor backtest ask with two
 * charts it had drawn itself, loaded no skill at all (its footer read `no skills loaded`), and named the
 * missing local deploy without ever saying WHY it was missing.
 *
 * This runs the REAL `turn resume --dispatch <id>` over that frozen dispatch, which is the exact command
 * that worker ran, and asserts the two sections its brief did not carry: the skill candidates for the
 * question's subject, and the real-evidence-or-say-why pre-flight.
 *
 * ## Why the question is written in by the TEST
 *
 * `turn freeze` blanks it. A colleague's question is precisely the content class the freeze allowlist exists
 * to drop (`live/turn/freeze/redact.ts`'s header), and widening that allowlist to make one test easier would
 * trade the property the whole lane is built on. So the fixture supplies the STRUCTURE — the dispatch
 * record, its decision, its lease, its ids — and the test supplies the incident's own question text as a
 * literal, exactly as `workerGroundingRefused.test.ts` supplies the answer its worker composed.
 *
 * ## The falsifiable witness
 *
 * The `SKILLS` heading is printed unconditionally now, so its presence alone proves little. The assertions
 * therefore turn on CONTENT: the pre-flight fires only for a real-artifact subject, and the ranked list
 * names a skill this build actually ships. The counter-case — a question with neither property — is
 * replayed in the same file and must produce neither, which is what shows the witness can fail.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "generated-charts-no-skill-1sep";

/** The incident's own question, tags stripped — blanked by the freeze, so the test carries it. */
const MONITOR_ASK =
  "do a 7-day backtest for these monitors, post screenshots here so we can see when this would have alerted " +
  "(ensure it alerts when we care, is silent when we don't)";

/** A question of the same length raising neither a real artifact nor a skill subject — the counter-case. */
const PLAIN_ASK = "what did we decide about the retention window on the archive, and who signed that off";

let workspace: string;
let home: string;
let dispatchId: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-worker-brief-skills-"));
  home = join(workspace, "home");
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  dispatchId = JSON.stringify([manifest.ask.channel, manifest.ask.messageTs, manifest.ask.threadTs]);
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Write one question into the fixture's brief, standing in for what the freeze blanked.
 *
 * @param question the text to put where the real ask's question was
 */
function withQuestion({ question }: { question: string }): void {
  const path = join(home, "briefs", `${JSON.parse(dispatchId)[0]}-${JSON.parse(dispatchId)[1]}.json`);
  const brief = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...brief, question }), "utf8");
}

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
      env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("the monitor incident's own worker brief, replayed through the shipped binary", () => {
  it("now names the skill candidates for the question's subject, where it named none", () => {
    withQuestion({ question: MONITOR_ASK });

    const { status, stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(status).toBe(0);
    expect(stdout).toContain("SKILLS OWNING THIS SUBJECT");
    expect(stdout).toContain("name every one you");
  });

  it("now tells the worker a picture it generated is not the real artifact, and that the REASON is required", () => {
    withQuestion({ question: MONITOR_ASK });

    const { stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(stdout).toContain("REAL EVIDENCE, OR SAY WHY");
    expect(stdout).toContain("substitutedForReal");
    expect(stdout).toContain("state WHY, in one line");
  });

  it("says the skills section out loud even when nothing matches, and never prints the artifact pre-flight then", () => {
    withQuestion({ question: PLAIN_ASK });

    const { stdout } = runSlopweaver({ args: ["turn", "resume", "--dispatch", dispatchId, "--home", home] });

    expect(stdout).toContain("SKILLS");
    expect(stdout).not.toContain("REAL EVIDENCE, OR SAY WHY");
  });
});
