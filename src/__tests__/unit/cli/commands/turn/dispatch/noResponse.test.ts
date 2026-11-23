/**
 * `slopweaver turn dispatch` — the `no-response` and `for-a-human` endings: what each records, the exclusion
 * registry, and the capture-checklist cleanup that must land before the terminal does.
 *
 * The `fresh-visible-session` tier itself calls the REAL `productionSpawnDeps()`/`readScreen` — hardwired,
 * not injected, deliberately: that lane is proven by the owner's own watched live run, never an automated
 * fixture faking a terminal. See `AGENTS.md`'s own doctrine on this.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runTurnDispatch } from "../../../../../../cli/commands/turn/dispatch.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { currentlyIgnoredAsks } from "../../../../../../live/ask/ignoreStore.js";
import { appendAskLifecycleEvent } from "../../../../../../live/ask/store.js";
import { CAPTURE_CARD } from "./fixtures.js";
import { fixture, lastLifecycleEvent, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn dispatch — no-response", () => {
  it("records triaged-no-response and exits OK, dispatching nothing", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "casual greeting, no reply owed",
        response: "no-response",
        schemaVersion: 1,
      },
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
    expect(lastLifecycleEvent<{ kind: string }>({ home })!.kind).toBe("triaged-no-response");
  });

  /**
   * The fourth ending: a reply IS owed and a person should give it. Same path as
   * no-response — nothing dispatched, nothing posted — but the terminal it records must not be triage's.
   */
  it("records left-for-a-human, never triaged-no-response, for a for-a-human decision", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "a lockout is IT's to answer",
        response: "for-a-human",
        schemaVersion: 1,
      },
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
    expect(lastLifecycleEvent<{ kind: string; reason: string }>({ home })).toEqual(
      expect.objectContaining({ kind: "left-for-a-human", reason: "a lockout is IT's to answer" }),
    );
  });

  it("holds a for-a-human ask whose cleanup stalled at handover-cleanup-intended, never triage's intent", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "a lockout is IT's to answer",
        response: "for-a-human",
        schemaVersion: 1,
      },
      started: CAPTURE_CARD,
    });

    // No bot token configured, so the checklist delete cannot be confirmed and the terminal never lands.
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
    expect(lastLifecycleEvent<{ kind: string }>({ home })!.kind).toBe("handover-cleanup-intended");
  });

  /**
   * The owner's own shape for a burst: a later tag that needs no answer goes on the exclusion
   * registry and never comes up again. It is the judge's call, so a plain `no-response` writes nothing.
   */
  it("writes the exclusion registry when the decision asks for it, carrying the rationale as the reason", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        exclude: true,
        rationale: "their own follow-up correcting a typo in the ask above — nothing to answer",
        response: "no-response",
        schemaVersion: 1,
      },
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
    const ignored = currentlyIgnoredAsks({ home }).get(JSON.stringify(["C1", "1.1"]))!;
    expect(ignored.reason).toBe("their own follow-up correcting a typo in the ask above — nothing to answer");
  });

  it("writes NO exclusion for an ordinary no-response, which records one judgement rather than a suppression", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "casual greeting, no reply owed",
        response: "no-response",
        schemaVersion: 1,
      },
    });

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

    expect(currentlyIgnoredAsks({ home }).size).toBe(0);
  });

  it("records the exact identity, rationale, and (absent) delete target when no capture checklist exists", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "casual greeting, no reply owed",
        response: "no-response",
        schemaVersion: 1,
      },
    });

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

    const last = lastLifecycleEvent<{
      kind: string;
      channel: string;
      messageTs: string;
      reason: string;
      checklistDelete?: unknown;
    }>({ home })!;
    expect(last.kind).toBe("triaged-no-response");
    expect(last.channel).toBe("C1");
    expect(last.messageTs).toBe("1.1");
    expect(last.reason).toBe("casual greeting, no reply owed");
  });

  /**
   * The reaction half of the same terminal, and the defect that made it necessary: this path recorded its
   * judgement and stopped, so the capture `:eyes:` stood over an ask that had been handled correctly.
   * Measured twice, in two different sessions on two different asks — the second one by a
   * session that believed in good faith it had retired its indicators, which is why this is wiring rather
   * than a convention.
   *
   * With no bot token the settle cannot reach Slack, and that is exactly the property worth pinning
   * network-free: the JUDGEMENT must survive its chrome failing. A reaction that could not be settled is
   * reported and the verb still succeeds, because exiting non-zero here would say the no-response decision
   * failed when only its emoji did.
   */
  it("still records the terminal judgement, and still succeeds, when the reaction cannot be settled", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "casual greeting, no reply owed",
        response: "no-response",
        schemaVersion: 1,
      },
    });
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        kind: "captured",
        messageTs: "1.1",
        surface: "channel",
        threadTs: "1.1",
        tsIso: "2026-08-25T12:30:24.000Z",
        userId: "U0OWNER",
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

    expect(code).toBe(EXIT_OK);
    expect(lastLifecycleEvent<{ kind: string }>({ home })!.kind).toBe("triaged-no-response");
  });

  /**
   * A capture checklist exists, but no Slack bot token is configured — the one real, network-free seam this
   * path exposes; `handleNoResponse` builds its own live transport, not an injected one, the same deliberate
   * choice this file's own header already documents for the fresh-session tier. This proves the fix's other
   * half: the terminal `triaged-no-response` must NEVER be appended when cleanup could not even be
   * attempted, so the ask stays a real, recoverable `triage-cleanup-intended` candidate rather than silently
   * claiming completion. The delete-succeeds path needs a real Slack round trip, so it is not this lane's
   * job. The integration test this comment used to name (`routingNoResponseCleanup.test.ts`) does not
   * exist and, per `git log --diff-filter=A --all`, never did — a false pointer that read as coverage. It
   * is named here as ABSENT rather than quietly deleted, because "the other test covers it" is exactly the
   * belief a stale reference creates.
   */
  it("refuses loudly and stays at triage-cleanup-intended when a checklist exists but no bot token is configured", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "casual greeting, no reply owed",
        response: "no-response",
        schemaVersion: 1,
      },
      started: { turnId: "turn-capture-1", workingTs: "1.2" },
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
    const last = lastLifecycleEvent<{
      kind: string;
      checklistDelete?: { turnId: string; workingTs: string };
    }>({ home })!;
    expect(last.kind).toBe("triage-cleanup-intended");
    expect(last.checklistDelete).toEqual({ turnId: "turn-capture-1", workingTs: "1.2" });
  });

  /**
   * Confirmed real: `brief.started` can come from caller-supplied
   * `--turn-id`/`--working-ts` flags that disagree with what the lifecycle actually recorded as posted. Since
   * Slack's delete treats a nonexistent message as a successful no-op, trusting a mismatched `brief.started`
   * would let cleanup "succeed" against the wrong message while the REAL checklist stays stuck forever. The
   * fix: the delete target is always the lifecycle's own recorded `checklist-posted` ref when one exists,
   * never the brief's value directly.
   */
  it("prefers the lifecycle's own recorded checklist ref over a mismatched brief.started", async () => {
    const { briefPath, decisionPath, home } = fixture({
      decision: {
        confidence: "high",
        rationale: "casual greeting, no reply owed",
        response: "no-response",
        schemaVersion: 1,
      },
      started: { turnId: "turn-wrong", workingTs: "9.9" },
    });
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        kind: "captured",
        messageTs: "1.1",
        surface: "channel",
        threadTs: "1.1",
        tsIso: "t0",
        userId: "U0OWNER",
      },
      home,
    });
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        kind: "checklist-posted",
        messageTs: "1.1",
        threadTs: "1.1",
        tsIso: "t1",
        turnId: "turn-real",
        workingTs: "1.2",
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

    // No bot token configured, so the delete is never attempted — the property under test is which target
    // WOULD have been used, which `triage-cleanup-intended`'s recorded `checklistDelete` already reveals.
    expect(code).toBe(EXIT_ERROR);
    const last = lastLifecycleEvent<{
      kind: string;
      checklistDelete?: { turnId: string; workingTs: string };
    }>({ home })!;
    expect(last.kind).toBe("triage-cleanup-intended");
    expect(last.checklistDelete).toEqual({ turnId: "turn-real", workingTs: "1.2" });
  });
});
