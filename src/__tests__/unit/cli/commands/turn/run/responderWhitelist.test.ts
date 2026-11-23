/*
 * The `turn answer` responder gate and its ordering: a hand-authored brief naming the owner is refused when the
 * whitelist is absent, the refusal comes before the bot-token check, and a whitelisted user reaches that next gate.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnAnswer } from "../../../../../../cli/commands/turn/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { DECISION, FULL_BRIEF, fixtureDirs, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/**
 * `turn answer` reads a brief FILE, and a brief file carries no signature — `userId` inside it is exactly as
 * editable as a flag. This is the counterexample the pre-mortem gave: an absent responder whitelist is
 * supposed to refuse EVERYONE, but a hand-authored brief whose `userId` happened to equal the owner used to
 * sail through, because nothing on this path ever consulted the whitelist at all.
 */
describe("turn answer — responder whitelist", () => {
  /** Write a brief + decision + a trivial answer to a fresh temp dir, and return their paths plus the temp home. */
  function fixtureFiles({ userId = "U0OWNER" }: { userId?: string } = {}): {
    readonly answerPath: string;
    readonly briefPath: string;
    readonly decisionPath: string;
    readonly home: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-answer-"));
    fixtureDirs.push(dir);
    const briefPath = join(dir, "brief.json");
    const decisionPath = join(dir, "decision.json");
    const answerPath = join(dir, "answer.json");
    writeFileSync(briefPath, JSON.stringify({ ...FULL_BRIEF, userId }), "utf8");
    writeFileSync(decisionPath, JSON.stringify(DECISION), "utf8");
    // A minimal but schema-VALID answer arm — `unreachable`-grounded against the brief's own unavailable
    // capability, so it needs no live-verb need to be real. These tests are about the responder gate's
    // ORDERING, not the answer's content, but a schema-invalid or ungrounded answer would refuse with
    // EXIT_ERROR before the gate ever runs, which would make every test below pass for the wrong reason.
    writeFileSync(
      answerPath,
      JSON.stringify({
        body: [{ runs: [{ text: "because we said so", type: "text" }], type: "paragraph" }],
        citations: [],
        grounding: {
          evidence: {
            consultedEmpty: [],
            couldNotSee: { blindSpots: ["nothing checked yet"] },
            premiseChecks: [],
            read: [],
          },
          kind: "unreachable",
          provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
          surface: { id: "test", what: "a test surface" },
          why: "this is a fixture, not a real investigation",
        },
        images: [],
        kind: "answer",
        lead: "because we said so",
      }),
      "utf8",
    );
    return { answerPath, briefPath, decisionPath, home: dir };
  }

  it("refuses a hand-authored brief whose userId is the owner, when the whitelist is absent — the exact bypass this closes", async () => {
    const { answerPath, briefPath, decisionPath, home } = fixtureFiles({ userId: "U0OWNER" });

    const code = await runTurnAnswer([
      "node",
      "slopweaver",
      "turn",
      "answer",
      "--brief",
      briefPath,
      "--answer",
      answerPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses before ever checking for a Slack bot token — no token is configured in this temp home either", async () => {
    const { answerPath, briefPath, decisionPath, home } = fixtureFiles();

    // If the gate ran AFTER the token check, this would fail with a token-missing message instead of the
    // responder-refusal one; both are absent here, so only the ordering below can be what is under test.
    const code = await runTurnAnswer([
      "node",
      "slopweaver",
      "turn",
      "answer",
      "--brief",
      briefPath,
      "--answer",
      answerPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("admits a whitelisted userId and proceeds far enough to hit the NEXT real gate — the missing token", async () => {
    const { answerPath, briefPath, decisionPath, home } = fixtureFiles({ userId: "U0OWNER" });
    writeFileSync(stateHomePaths({ home }).respondersJson, JSON.stringify(["U0OWNER"]), "utf8");

    const code = await runTurnAnswer([
      "node",
      "slopweaver",
      "turn",
      "answer",
      "--brief",
      briefPath,
      "--answer",
      answerPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);

    // Past the responder gate now — the very next check this verb makes is the bot token, which this temp
    // home also does not have. EXIT_ERROR (not EXIT_EXPECTED_EMPTY) is what proves the whitelist admitted it.
    expect(code).toBe(EXIT_ERROR);
  });
});
