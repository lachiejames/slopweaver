/**
 * `slopweaver turn resume --dispatch --answer` (FINISH mode) — what refuses with no terminal marker, what records
 * the ready marker, and a worker recovering from a grounding refusal by re-running the same command.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnResume } from "../../../../../../cli/commands/turn/resume.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";
import { readCurrentGenerationTurnMarker } from "../../../../../../live/turn/turnMarkerStore.js";
import { removeFixtureDirs } from "../dispatch/harness.js";
import { ASK_IDENTITY, DECISION, DISPATCH_ID } from "./fixtures.js";
import { dispatchedFixture, writeRecord } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn resume --dispatch --answer (FINISH mode)", () => {
  /** A schema-valid answer, grounded consistently with `DECISION` (no live needs, so conversation grounding fits). */
  function writeValidAnswer({ home }: { home: string }): string {
    const answerPath = join(home, "answer.json");
    writeFileSync(
      answerPath,
      JSON.stringify({
        body: [{ runs: [{ text: "3 open PRs", type: "text" }], type: "paragraph" }],
        citations: [],
        grounding: {
          evidence: {
            consultedEmpty: [],
            couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
            premiseChecks: [],
            read: [],
          },
          kind: "conversation",
          provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
          reason: "context alone answers this",
        },
        images: [],
        kind: "answer",
        lead: "3 open PRs",
      }),
      "utf8",
    );
    return answerPath;
  }

  it("refuses when no dispatch record exists at all", () => {
    const { home } = dispatchedFixture();
    const answerPath = writeValidAnswer({ home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });

  it("refuses when the durable record belongs to a PRIOR dispatch generation", () => {
    const { briefPath, home } = dispatchedFixture({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" });
    writeRecord({ briefPath, home, leaseExpiresAt: "2020-01-01T00:00:00.000Z" });
    const answerPath = writeValidAnswer({ home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });

  it("refuses an answer whose grounding contradicts the CURRENT generation's decision — RETRYABLE, no terminal marker", () => {
    // A grounding mismatch is decidable from the decision and this answer's own bytes alone — no new
    // investigation could change the outcome — so it must never become the same terminal, sweep-finalised
    // FAILED marker as a worker's considered `--failed` give-up. It writes NO durable marker at all, so the
    // SAME session can fix the grounding field and re-run this exact command.
    const requiredNeedDecision: RespondDecision = {
      ...DECISION,
      needs: [{ capabilityId: "fleet-status", reason: "must inspect live state", requirement: "required" }],
    };
    const { briefPath, home } = dispatchedFixture({ decision: requiredNeedDecision });
    writeRecord({ briefPath, decision: requiredNeedDecision, home });
    // A conversation-grounded answer contradicts the required live need.
    const answerPath = writeValidAnswer({ home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toBeUndefined();
  });

  it("refuses malformed answer JSON WITHOUT a terminal marker — a compose-time refusal is not the worker's own failure", () => {
    // MEASURED DEFECT: an over-count/aggregate-cap answer went through this exact code path
    // (parseAnswerArm's `.transform()` refusing a `truncateAnswerForm` violation) and — before this fix —
    // hit `failFinish`, which durably wrote `kind: "failed"` and finalised the ask while the worker was
    // still alive and about to fix its answer. Any refusal along this path (malformed JSON included) must
    // leave no durable marker, so the sweep keeps reading the ask as still-working.
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, "{ not valid json", "utf8");

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toBeUndefined();
  });

  it("refuses an answer that fails the answer-arm schema WITHOUT a terminal marker — same non-terminal contract", () => {
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });
    const answerPath = join(home, "answer.json");
    // Missing `lead` and `grounding` — a schema-invalid `answer` arm, the same union `parseAnswerArm` refuses
    // an over-cap body/index through.
    writeFileSync(answerPath, JSON.stringify({ body: [], citations: [], images: [], kind: "answer" }), "utf8");

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toBeUndefined();
  });

  it("accepts a consistent answer and reaches EXIT_OK, durably recording the ready marker", () => {
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });
    const answerPath = writeValidAnswer({ home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_OK);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toStrictEqual({
      answerPath,
      dispatchId: DISPATCH_ID,
      kind: "ready",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      // The real clock, so the exact instant is not assertable — its SHAPE is, and that is what a later
      // sweep parses to say how long an answer has been sitting uncarried.
      recordedAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it("a worker recovers from a grounding refusal by fixing the SAME answer and re-running this exact command", () => {
    const requiredNeedDecision: RespondDecision = {
      ...DECISION,
      needs: [{ capabilityId: "fleet-status", reason: "must inspect live state", requirement: "required" }],
    };
    const { briefPath, home } = dispatchedFixture({ decision: requiredNeedDecision });
    writeRecord({ briefPath, decision: requiredNeedDecision, home });
    const answerPath = writeValidAnswer({ home });

    const firstAttempt = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(firstAttempt).toBe(EXIT_ERROR);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toBeUndefined();

    // The SAME worker fixes the SAME file's grounding to match the required need, and re-runs the SAME
    // command — never a `--failed` give-up, and nothing durable stopped it from trying again.
    writeFileSync(
      answerPath,
      JSON.stringify({
        body: [{ runs: [{ text: "3 open PRs", type: "text" }], type: "paragraph" }],
        citations: [],
        grounding: {
          capability: { command: ["private-cli", "fleet", "status"], id: "fleet-status", what: "live state" },
          evidence: {
            consultedEmpty: [],
            couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
            premiseChecks: [],
            read: [],
          },
          kind: "verb",
          provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
          result: "3 open PRs",
        },
        images: [],
        kind: "answer",
        lead: "3 open PRs",
      }),
      "utf8",
    );

    const secondAttempt = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      answerPath,
      "--home",
      home,
    ]);
    expect(secondAttempt).toBe(EXIT_OK);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })?.kind).toBe("ready");
  });
});
