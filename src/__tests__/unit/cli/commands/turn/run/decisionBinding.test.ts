/*
 * The `turn answer` decision binding: a `--decision` file that differs from the one the ask was dispatched under is
 * refused, still refused after a lease-expired event, and any decision file is refused once the ask has resolved.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnAnswer } from "../../../../../../cli/commands/turn/run.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { askIdentityOf } from "../../../../../../live/ask/identity.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../../../live/ask/store.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";
import { FULL_BRIEF, fixtureDirs, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/**
 * `turn answer` reads a `--decision` FILE, and a file carries no proof it is the one `turn dispatch` actually
 * dispatched — the same "a hand-editable local file is not proof" reasoning the responder-whitelist tests
 * above already establish for a hand-authored brief. When this ask HAS a real recorded dispatch, a different
 * `--decision` at answer time must be refused.
 */
describe("turn answer — decision binding", () => {
  const DISPATCHED_DECISION: RespondDecision = {
    confidence: "high",
    needs: [
      { capabilityId: "github-vulnerability-report", reason: "must inspect live state", requirement: "required" },
    ],
    rationale: "live state is required",
    response: "respond",
    truthMode: "current",
    schemaVersion: 1,
    tier: "inline",
  };

  /** A schema-valid `conversation`-grounded answer — content is irrelevant to these tests, only its shape. */
  function writeConversationAnswer({ answerPath }: { answerPath: string }): void {
    writeFileSync(
      answerPath,
      JSON.stringify({
        body: [{ runs: [{ text: "because we said so", type: "text" }], type: "paragraph" }],
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
        lead: "because we said so",
      }),
      "utf8",
    );
  }

  /**
   * Write the brief + a fresh `dispatched(DISPATCHED_DECISION)` lifecycle entry for a new ask, then a
   * DIFFERENT (but schema-valid) decision at `--decision` and a `conversation`-grounded answer — the exact
   * substitution `validateAnswerForDispatch` alone cannot catch, since it only ever sees whichever decision
   * this verb hands it.
   */
  function fixtureWithSubstitutedDecision(): {
    readonly answerPath: string;
    readonly briefPath: string;
    readonly decisionPath: string;
    readonly dir: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-answer-decision-binding-"));
    fixtureDirs.push(dir);
    const briefPath = join(dir, "brief.json");
    const decisionPath = join(dir, "decision.json");
    const answerPath = join(dir, "answer.json");
    const brief = { ...FULL_BRIEF, userId: "U0OWNER" };
    writeFileSync(briefPath, JSON.stringify(brief), "utf8");

    const askIdentity = askIdentityOf({ source: brief });
    ensureCapturedAskLifecycle({ askIdentity, home: dir, surface: "channel", userId: "U0OWNER" });
    appendAskLifecycleEvent({
      event: {
        ...askIdentity,
        decision: DISPATCHED_DECISION,
        kind: "dispatched",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        tier: "inline",
        tsIso: "2026-08-13T00:00:00.000Z",
      },
      home: dir,
    });

    // A DIFFERENT decision — identical except needs: [] — claiming context alone was sufficient, contradicting
    // the actually-dispatched decision's required live need.
    const suppliedDecision: RespondDecision = { ...DISPATCHED_DECISION, needs: [] };
    writeFileSync(decisionPath, JSON.stringify(suppliedDecision), "utf8");
    writeConversationAnswer({ answerPath });
    return { answerPath, briefPath, decisionPath, dir };
  }

  it("refuses a --decision file that differs from the decision this ask was actually dispatched under", async () => {
    const { answerPath, briefPath, decisionPath, dir } = fixtureWithSubstitutedDecision();

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
      dir,
    ]);

    expect(code).toBe(EXIT_ERROR);
  });

  it("still refuses the substitution after a lease-expired event — a fold that ADVANCES past dispatched must not hide the recorded decision", async () => {
    const { answerPath, briefPath, decisionPath, dir } = fixtureWithSubstitutedDecision();
    const brief = { ...FULL_BRIEF, userId: "U0OWNER" };
    const askIdentity = askIdentityOf({ source: brief });
    appendAskLifecycleEvent({
      event: { ...askIdentity, kind: "lease-expired", tsIso: "2026-08-13T01:00:00.000Z" },
      home: dir,
    });

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
      dir,
    ]);

    expect(code).toBe(EXIT_ERROR);
  });

  it("refuses ANY decision file, even one that matches exactly, once the ask has been resolved (re-dispatched as no-response) since", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-answer-resolved-since-"));
    fixtureDirs.push(dir);
    const briefPath = join(dir, "brief.json");
    const decisionPath = join(dir, "decision.json");
    const answerPath = join(dir, "answer.json");
    const brief = { ...FULL_BRIEF, userId: "U0OWNER" };
    writeFileSync(briefPath, JSON.stringify(brief), "utf8");

    const askIdentity = askIdentityOf({ source: brief });
    ensureCapturedAskLifecycle({ askIdentity, home: dir, surface: "channel", userId: "U0OWNER" });
    appendAskLifecycleEvent({
      event: {
        ...askIdentity,
        decision: DISPATCHED_DECISION,
        kind: "dispatched",
        leaseExpiresAt: "2026-08-13T00:00:00.000Z",
        tier: "inline",
        tsIso: "2026-08-13T00:00:00.000Z",
      },
      home: dir,
    });
    // Lease expires, the session re-judges, and decides the ask needs no reply at all — the ask is DONE.
    appendAskLifecycleEvent({
      event: { ...askIdentity, kind: "lease-expired", tsIso: "2026-08-13T01:00:00.000Z" },
      home: dir,
    });
    appendAskLifecycleEvent({
      event: {
        ...askIdentity,
        kind: "triaged-no-response",
        reason: "the ask was withdrawn",
        tsIso: "2026-08-13T02:00:00.000Z",
      },
      home: dir,
    });

    // The EXACT decision that WAS dispatched, matching byte-for-byte — the substitution check alone would pass.
    writeFileSync(decisionPath, JSON.stringify(DISPATCHED_DECISION), "utf8");
    writeConversationAnswer({ answerPath });

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
      dir,
    ]);

    expect(code).toBe(EXIT_ERROR);
  });
});
