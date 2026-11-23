/**
 * `askSessionPlan` over injected reads: the plan it builds from the running checkout, the decision's model
 * and the supervisor's host, and how the asking user's display handle is resolved through the two roster
 * layers — the override first, the derived roster next, the raw Slack id when neither knows them.
 */
import { describe, expect, it } from "vitest";

import { planAskSession } from "../../../../cmux/plan.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import { type AskSessionPlanDeps, askSessionPlan } from "../../../../live/turn/askSessionPlan.js";
import { freshSessionPickupPrompt } from "../../../../live/turn/dispatch.js";
import type { RoutingJudgementInput } from "../../../../live/turn/judgement.js";
import type { RespondDecision } from "../../../../live/turn/tier.js";
import type { DerivedRoster } from "../../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../../silver/identity.js";
import type { IdentityRosterSnapshot } from "../../../../silver/identityRoster.js";

const HOME = "/fixture/home";
const SPAWNED_AT = "2026-10-13T09:00:00.000Z";
const DISPATCH_ID = "dispatch-1";
const QUESTION = "why did the staging pool exhaust";

const ASK: AskIdentity = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

/** A fresh-session decision that names no model, so the worker's default tier applies. */
const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "a live investigation is needed",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

/**
 * A routing input judged by a supervisor on the given host.
 *
 * @returns the input
 */
function routingOn({ host }: { host: "claude-code" | "codex" }): RoutingJudgementInput {
  return {
    availableCapabilities: [],
    context: { controlPlane: { ownerAddressingText: QUESTION, structuralMetadata: [] }, quotedEvidence: [] },
    execution: { mode: "continuous-drain", supervisorHost: host },
  };
}

/** A derived roster that knows U_ADA as `ada-l`. */
const DERIVED: DerivedRoster = {
  heldPersonIds: new Set(),
  people: [
    {
      confidence: "email",
      id: "p-ada",
      identities: [{ handle: "ada-l", name: "Ada Lovelace", nativeId: "U_ADA", source: "slack" }],
      kind: "person",
    },
  ],
};

/** An override roster that claims U_ADA under a different handle. */
const OVERRIDES: readonly IdentityRecord[] = [
  {
    handle: "ada",
    id: "person:ada",
    identities: [{ nativeId: "U_ADA", source: "slack" }],
    name: "Ada Lovelace",
  },
];

/**
 * The human roster snapshot the async caller would have read once from the store, at revision 1.
 *
 * @returns the snapshot
 */
function snapshotOf({ records }: { records: readonly IdentityRecord[] }): IdentityRosterSnapshot {
  return { records, retiredFile: undefined, revision: 1 };
}

/**
 * Reads answering from fixed values, recording each home and roster revision the derived roster was read under.
 *
 * @param branch what the checkout's branch read answers, `undefined` for a detached HEAD
 * @returns the seam and the reads the derived roster received
 */
function fixedReads({ branch }: { branch: string | undefined }): {
  readonly deps: AskSessionPlanDeps;
  readonly homesRead: string[];
} {
  const homesRead: string[] = [];
  const readDerivedRoster: AskSessionPlanDeps["readDerivedRoster"] = ({ home, rosterRevision }) => {
    homesRead.push(`derived:${home}@${String(rosterRevision)}`);
    return { roster: DERIVED };
  };
  return {
    deps: {
      checkoutBranch: () => branch,
      checkoutRoot: () => "/fixture/repo",
      readDerivedRoster,
    },
    homesRead,
  };
}

describe("askSessionPlan", () => {
  it("plans the running checkout at its own branch, on the default Opus worker at high effort, briefed with the dispatch id", () => {
    const reads = fixedReads({ branch: "main" });

    const plan = askSessionPlan({
      askIdentity: ASK,
      askQuestion: QUESTION,
      decision: DECISION,
      deps: reads.deps,
      dispatchId: DISPATCH_ID,
      home: HOME,
      identityRoster: snapshotOf({ records: [] }),
      routingInput: routingOn({ host: "claude-code" }),
      spawnedAt: SPAWNED_AT,
      userId: "U_ADA",
    });

    expect(plan.cwd).toBe("/fixture/repo");
    expect(plan.repoRoot).toBe("/fixture/repo");
    expect(plan.branch).toBe("main");
    expect(plan.model).toBe("opus");
    expect(plan.effort).toBe("high");
    expect(plan.host).toBe("claude-code");
    expect(plan.driver).toBe("claude");
    expect(plan.spawnedAt).toBe(SPAWNED_AT);
    expect(plan.pickupCommand).toBe(freshSessionPickupPrompt({ dispatchId: DISPATCH_ID }));
    expect(plan).toEqual(
      planAskSession({
        askChannel: "C1",
        askMessageTs: "1785000000.000100",
        askQuestion: QUESTION,
        branch: "main",
        effort: "high",
        host: "claude-code",
        model: "opus",
        pickupCommand: freshSessionPickupPrompt({ dispatchId: DISPATCH_ID }),
        repoRoot: "/fixture/repo",
        respondingToHandle: "@ada-l",
        spawnedAt: SPAWNED_AT,
      }),
    );
    expect(reads.homesRead).toEqual([`derived:${HOME}@1`]);
  });

  it("names the branch `detached` when the checkout has none", () => {
    const plan = askSessionPlan({
      askIdentity: ASK,
      askQuestion: QUESTION,
      decision: DECISION,
      deps: fixedReads({ branch: undefined }).deps,
      dispatchId: DISPATCH_ID,
      home: HOME,
      identityRoster: snapshotOf({ records: [] }),
      routingInput: routingOn({ host: "claude-code" }),
      spawnedAt: SPAWNED_AT,
      userId: "U_ADA",
    });

    expect(plan.branch).toBe("detached");
  });

  it("takes the override roster's handle over the derived roster's for the same Slack id", () => {
    const plan = askSessionPlan({
      askIdentity: ASK,
      askQuestion: QUESTION,
      decision: DECISION,
      deps: fixedReads({ branch: "main" }).deps,
      dispatchId: DISPATCH_ID,
      home: HOME,
      identityRoster: snapshotOf({ records: OVERRIDES }),
      routingInput: routingOn({ host: "claude-code" }),
      spawnedAt: SPAWNED_AT,
      userId: "U_ADA",
    });

    expect(plan.respondingToHandle).toBe("@ada");
  });

  it("falls back to the raw Slack id when neither roster knows the asker", () => {
    const plan = askSessionPlan({
      askIdentity: ASK,
      askQuestion: QUESTION,
      decision: DECISION,
      deps: fixedReads({ branch: "main" }).deps,
      dispatchId: DISPATCH_ID,
      home: HOME,
      identityRoster: snapshotOf({ records: OVERRIDES }),
      routingInput: routingOn({ host: "claude-code" }),
      spawnedAt: SPAWNED_AT,
      userId: "U_STRANGER",
    });

    expect(plan.respondingToHandle).toBe("U_STRANGER");
  });

  it("pins the decision's named model and pins no effort when that model is not Opus", () => {
    const plan = askSessionPlan({
      askIdentity: ASK,
      askQuestion: QUESTION,
      decision: { ...DECISION, model: "sonnet" },
      deps: fixedReads({ branch: "main" }).deps,
      dispatchId: DISPATCH_ID,
      home: HOME,
      identityRoster: snapshotOf({ records: [] }),
      routingInput: routingOn({ host: "claude-code" }),
      spawnedAt: SPAWNED_AT,
      userId: "U_ADA",
    });

    expect(plan.model).toBe("sonnet");
    expect(plan.effort).toBe(undefined);
  });

  it("plans a Codex seat with no effort when the supervisor runs on Codex", () => {
    const plan = askSessionPlan({
      askIdentity: ASK,
      askQuestion: QUESTION,
      decision: DECISION,
      deps: fixedReads({ branch: "main" }).deps,
      dispatchId: DISPATCH_ID,
      home: HOME,
      identityRoster: snapshotOf({ records: [] }),
      routingInput: routingOn({ host: "codex" }),
      spawnedAt: SPAWNED_AT,
      userId: "U_ADA",
    });

    expect(plan.host).toBe("codex");
    expect(plan.driver).toBe("codex");
    expect(plan.model).toBe("opus");
    expect(plan.effort).toBe(undefined);
  });
});
