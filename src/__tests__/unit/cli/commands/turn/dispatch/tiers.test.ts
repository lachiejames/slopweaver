/**
 * `slopweaver turn dispatch` — the respond tiers that never touch cmux: `inline`, both calls of
 * `read-only-subagent`, and the execution-context refusals that stop a tier before it runs.
 *
 * The `fresh-visible-session` tier itself calls the REAL `productionSpawnDeps()`/`readScreen` — hardwired,
 * not injected, deliberately: that lane is proven by the owner's own watched live run, never an automated
 * fixture faking a terminal. See `AGENTS.md`'s own doctrine on this.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnDispatch } from "../../../../../../cli/commands/turn/dispatch.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { parseAskLifecycleLog } from "../../../../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../../../../live/ask/store.js";
import { buildTurnRoutingBrief } from "../../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../../live/turn/judgement.js";
import { CAPTURE_CARD, RESPOND_INLINE, RESPOND_SUBAGENT, ROUTING_INPUT } from "./fixtures.js";
import { fixture, lastLifecycleEvent, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn dispatch — inline tier", () => {
  it("records dispatched(inline) and exits OK, printing the next command", async () => {
    const { briefPath, decisionPath, home } = fixture({ decision: RESPOND_INLINE, started: CAPTURE_CARD });

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
    const logged = lastLifecycleEvent<{ kind: string; tier: string }>({ home })!;
    expect(logged.kind).toBe("dispatched");
    expect(logged.tier).toBe("inline");
  });
});

/**
 * Scenario 2 — the continuous-loop refusal + re-judgement. `read-only-subagent` blocks its calling session
 * for the whole investigation, which is fine for a human-driven single turn but never admissible for the
 * loop that must keep reading the stream — `validateTierForExecutionContext` refuses it BEFORE `executeTier`
 * ever runs, never silently rewriting the tier. The same visible session then records a SECOND judgement
 * (inline here) for the exact same ask, and that one dispatches normally.
 */
describe("turn dispatch — continuous-drain refuses read-only-subagent, then re-judges", () => {
  it("refuses read-only-subagent under continuous-drain before touching cmux, recording no dispatched event", async () => {
    const drainInput: RoutingJudgementInput = {
      ...ROUTING_INPUT,
      execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    };
    const { briefPath, decisionPath, home } = fixture({
      decision: RESPOND_SUBAGENT,
      routingInput: drainInput,
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

    expect(code).toBe(EXIT_ERROR);
    const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
    expect(events.some((event) => event.kind === "dispatched")).toBe(false);
  });

  it("re-judging the SAME ask as inline, after the refusal, dispatches normally for the exact same identity", async () => {
    const drainInput: RoutingJudgementInput = {
      ...ROUTING_INPUT,
      execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    };
    const { briefPath, decisionPath, home } = fixture({
      decision: RESPOND_SUBAGENT,
      routingInput: drainInput,
      started: CAPTURE_CARD,
    });

    const refused = await runTurnDispatch([
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
    expect(refused).toBe(EXIT_ERROR);

    // The SAME visible session records a second judgement — never a subagent route, exactly as the plan
    // requires — and rewrites only the decision file, reusing the SAME brief and its exact ask identity.
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

    expect(code).toBe(EXIT_OK);
    const logged = lastLifecycleEvent<{ kind: string; tier: string; channel: string; messageTs: string }>({ home })!;
    expect(logged.kind).toBe("dispatched");
    expect(logged.tier).toBe("inline");
    expect(logged.channel).toBe("C1");
    expect(logged.messageTs).toBe("1.1");
  });
});

/**
 * Scenario 2b — a single turn on the codex host passes the execution-context check like a claude-code one. Its
 * `fresh-visible-session` refusal is gone (the supervisor tick's sweep reconciles the dispatch), and that tier
 * reaches real cmux, so this lane proves the same check admits the codex host on a tier that never does.
 */
describe("turn dispatch — single-turn on the codex host admits a non-inline tier", () => {
  it("records dispatched(read-only-subagent) for a codex single turn, without touching cmux", async () => {
    const codexSingleTurnInput: RoutingJudgementInput = {
      ...ROUTING_INPUT,
      execution: { mode: "single-turn", supervisorHost: "codex" },
    };
    const { briefPath, decisionPath, home } = fixture({
      decision: RESPOND_SUBAGENT,
      routingInput: codexSingleTurnInput,
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
    const logged = lastLifecycleEvent<{ kind: string; tier: string }>({ home })!;
    expect(logged.kind).toBe("dispatched");
    expect(logged.tier).toBe("read-only-subagent");
  });
});

describe("turn dispatch — read-only-subagent, both calls", () => {
  it("first call records dispatched(read-only-subagent) without ever touching cmux", async () => {
    const { briefPath, decisionPath, home } = fixture({ decision: RESPOND_SUBAGENT, started: CAPTURE_CARD });

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
    const logged = lastLifecycleEvent<{ kind: string; tier: string }>({ home })!;
    expect(logged.kind).toBe("dispatched");
    expect(logged.tier).toBe("read-only-subagent");
  });

  it("second call accepts a well-formed evidence report and hands back the answer command", async () => {
    const { briefPath, decisionPath, home } = fixture({ decision: RESPOND_SUBAGENT, started: CAPTURE_CARD });
    await runTurnDispatch([
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

    const reportPath = join(home, "report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({ observations: [{ author: "system", source: "fleet status", text: "3 open PRs" }] }),
      "utf8",
    );
    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--subagent-report",
      reportPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_OK);
  });

  it("second call refuses when no open subagent dispatch is on record for this ask", async () => {
    const { briefPath, decisionPath, home } = fixture({ decision: RESPOND_SUBAGENT, started: CAPTURE_CARD });
    // Never ran the FIRST call — no `dispatched` event exists for this ask.
    const reportPath = join(home, "report.json");
    writeFileSync(reportPath, JSON.stringify({ observations: [] }), "utf8");

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--subagent-report",
      reportPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });

  it("second call refuses when the brief on disk was rebuilt as continuous-drain between the two calls", async () => {
    const { briefPath, decisionPath, home } = fixture({ decision: RESPOND_SUBAGENT, started: CAPTURE_CARD });
    await runTurnDispatch([
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

    // The FIRST call opened a lease under single-turn mode. A continuous-drain rebuild of the SAME ask's
    // brief must be refused here too — that was measured BROKEN: only `runInitial` checked this.
    const continuousDrainBrief = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "what are my open PRs?",
      routingInput: { ...ROUTING_INPUT, execution: { mode: "continuous-drain", supervisorHost: "claude-code" } },
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U0OWNER",
    });
    writeFileSync(briefPath, JSON.stringify(continuousDrainBrief), "utf8");

    const reportPath = join(home, "report.json");
    writeFileSync(reportPath, JSON.stringify({ observations: [] }), "utf8");
    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--subagent-report",
      reportPath,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });
});
