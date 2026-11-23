/**
 * `slopweaver turn dispatch` — the gates an ask passes before any tier runs: the responder whitelist, the
 * permanent ignore registry, and the present-state check on a proposal ask.
 *
 * The `fresh-visible-session` tier itself calls the REAL `productionSpawnDeps()`/`readScreen` — hardwired,
 * not injected, deliberately: that lane is proven by the owner's own watched live run, never an automated
 * fixture faking a terminal. See `AGENTS.md`'s own doctrine on this.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnDispatch } from "../../../../../../cli/commands/turn/dispatch.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { appendIgnoredAsk } from "../../../../../../live/ask/ignoreStore.js";
import { buildTurnRoutingBrief } from "../../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../../live/turn/judgement.js";
import { CAPTURE_CARD, RESPOND_INLINE, ROUTING_INPUT } from "./fixtures.js";
import { fixture, fixtureDirs, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn dispatch — responder and ignore gates", () => {
  it("refuses a brief whose userId is not on the responder whitelist", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-noresp-"));
    fixtureDirs.push(home);
    const briefPath = join(home, "brief.json");
    const decisionPath = join(home, "decision.json");
    writeFileSync(
      briefPath,
      JSON.stringify(
        buildTurnRoutingBrief({
          channel: "C1",
          messageTs: "1.1",
          question: "why?",
          routingInput: ROUTING_INPUT,
          surface: "channel",
          threadTs: "1.1",
          unavailableCapabilities: [],
          userId: "U0OWNER",
        }),
      ),
      "utf8",
    );
    writeFileSync(decisionPath, JSON.stringify(RESPOND_INLINE), "utf8");

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses an ask the permanent ignore registry names, before ever reading the decision", async () => {
    const { briefPath, decisionPath, home } = fixture({ decision: RESPOND_INLINE, started: CAPTURE_CARD });
    appendIgnoredAsk({
      entry: {
        channel: "C1",
        ignoredAtIso: "2026-08-12T00:00:00.000Z",
        messageTs: "1.1",
        reason: "n/a",
        schemaVersion: 1,
      },
      home,
    });

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("turn dispatch — the present-state check on a proposal ask", () => {
  /** The same routing input, re-asked as a proposal — the classifier reads `ownerAddressingText` alone. */
  const PROPOSAL_INPUT: RoutingJudgementInput = {
    ...ROUTING_INPUT,
    context: {
      controlPlane: {
        ownerAddressingText: "should we stand up a second review queue, and what would it cost",
        structuralMetadata: [],
      },
      quotedEvidence: [],
    },
  };

  /**
   * The wiring, not the rule. `turn dispatch` reads a decision the visible session composed and never calls
   * `judgeRouting` at all, so the premise rule was dead code on the live path until it was called from
   * here. This test fails if that call is ever removed — which is the whole reason it sits in this file
   * rather than only beside the rule.
   */
  it("REFUSES a decision that costs a proposal without a leg that could check the premise", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        needs: [],
        rationale: "costing it from context alone",
        response: "respond",
        schemaVersion: 1,
        tier: "inline",
        truthMode: "none",
      },
      routingInput: PROPOSAL_INPUT,
    });

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_ERROR);
  });

  it("ACCEPTS the same proposal once the decision requires a leg that reads the world outside this process", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        needs: [{ capabilityId: "fleet-status", reason: "check whether one is already open", requirement: "required" }],
        rationale: "look first, then cost it",
        response: "respond",
        schemaVersion: 1,
        tier: "inline",
        truthMode: "current",
      },
      routingInput: PROPOSAL_INPUT,
      started: CAPTURE_CARD,
    });

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
  });
});
