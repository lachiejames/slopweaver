/**
 * `slopweaver turn resume --dispatch` (LOAD mode) run end to end over a real temp home: every refusal (an
 * unminted token, an ignored ask, no record, a prior generation, a card-less brief), the loads, and the
 * card-less refusal's own wording.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnResume } from "../../../../../../cli/commands/turn/resume.js";
import { cardlessResumeRefusal } from "../../../../../../cli/commands/turn/resumeLines.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { appendIgnoredAsk } from "../../../../../../live/ask/ignoreStore.js";
import { appendAskLifecycleEvent } from "../../../../../../live/ask/store.js";
import { fixtureDirs, removeFixtureDirs } from "../dispatch/harness.js";
import { ASK_IDENTITY, DISPATCH_ID, RESUME_CARD } from "./fixtures.js";
import { dispatchedFixture, writeRecord } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn resume --dispatch (LOAD mode)", () => {
  it("refuses a token this build never minted", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-resume-badtoken-"));
    fixtureDirs.push(home);
    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", "not json", "--home", home])).toBe(
      EXIT_ERROR,
    );
  });

  it("refuses an ask the permanent ignore registry names", () => {
    const { home } = dispatchedFixture();
    appendIgnoredAsk({
      entry: { ...ASK_IDENTITY, ignoredAtIso: "2026-08-13T00:00:00.000Z", reason: "n/a", schemaVersion: 1 },
      home,
    });

    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", DISPATCH_ID, "--home", home])).toBe(
      EXIT_ERROR,
    );
  });

  it("refuses when no dispatch record exists at all", () => {
    const { home } = dispatchedFixture();

    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", DISPATCH_ID, "--home", home])).toBe(
      EXIT_ERROR,
    );
  });

  it("refuses when the durable record belongs to a PRIOR dispatch generation — a different lease", () => {
    const { briefPath, home } = dispatchedFixture({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" });
    writeRecord({ briefPath, home, leaseExpiresAt: "2020-01-01T00:00:00.000Z" });

    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", DISPATCH_ID, "--home", home])).toBe(
      EXIT_ERROR,
    );
  });

  it("loads and prints the brief's question and the CURRENT generation's decision", () => {
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });

    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", DISPATCH_ID, "--home", home])).toBe(
      EXIT_OK,
    );
  });

  // The worker half of the structural guarantee: `turn dispatch` proves a card before it hands a
  // brief over, so a brief reaching HERE without one predates that gate or was hand-authored. The same
  // fixture with a card loads (the case directly above), which is what makes this a single-variable pair.
  it("refuses a brief carrying no live progress card, where the identical carded brief loads", () => {
    const { briefPath, home } = dispatchedFixture({ started: null });
    writeRecord({ briefPath, home });

    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", DISPATCH_ID, "--home", home])).toBe(
      EXIT_ERROR,
    );
  });

  // The other half of that gate, and the one it would otherwise get WRONG: a brief rebuilt for this ask
  // after its dispatch loses `started` while the card it names is still standing. The lifecycle log is the
  // surviving record of it, so the worker loads — same card-less brief as the case above, one row added.
  it("loads a card-less brief when the lifecycle log still carries the card the dispatch posted", () => {
    const { briefPath, home } = dispatchedFixture({ started: null });
    writeRecord({ briefPath, home });
    appendAskLifecycleEvent({
      event: {
        ...ASK_IDENTITY,
        kind: "checklist-posted",
        tsIso: "2026-08-13T00:00:00.000Z",
        turnId: RESUME_CARD.turnId,
        workingTs: RESUME_CARD.workingTs,
      },
      home,
    });

    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--dispatch", DISPATCH_ID, "--home", home])).toBe(
      EXIT_OK,
    );
  });
});

describe("cardlessResumeRefusal", () => {
  it("names the dispatch, both verbs that would refuse, and the re-dispatch that fixes it", () => {
    expect(cardlessResumeRefusal({ briefPath: "/s/briefs/C1-1785000000.000100.json", dispatchId: DISPATCH_ID })).toBe(
      `the brief for ${DISPATCH_ID} carries no live progress card, so there is nothing for this worker to ` +
        "keep honest and `turn status`/`turn watch` would both refuse. Re-run `slopweaver turn dispatch " +
        "--brief /s/briefs/C1-1785000000.000100.json --decision <decision.json>`, which posts one before it " +
        "hands a brief over.",
    );
  });
});
