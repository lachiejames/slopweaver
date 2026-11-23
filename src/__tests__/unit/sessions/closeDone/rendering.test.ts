/**
 * What the done-chat sweep says: one line per outcome, the counts, and the summary the briefing folds — including
 * the reap clause naming every dispatch child it closed. Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import type { CloseDonePlanItem } from "../../../../sessions/closeDone.js";
import {
  type CloseDoneOutcome,
  countCloseDone,
  renderCloseDoneOutcome,
  renderCloseDoneSummary,
} from "../../../../sessions/closeDoneOutcome.js";
import type { DoneEvidence } from "../../../../sessions/dispatchDoneEvidence.js";
import type { SessionItem } from "../../../../sessions/session.js";
import { workspace } from "../../cli/commands/session/closeDoneHarness.js";
import { row } from "../closeDonePlanFixtures.js";
import { REVIEW_KEY } from "../dispatchFixtures.js";
import { childRow, childWorkspace } from "./children.js";

describe("rendering", () => {
  const candidate = {
    evidence: { kind: "run-closed" } as const,
    kind: "candidate" as const,
    row: row(),
    workspace: workspace(),
  };

  it("renders a close with the live ref, the slug and the evidence", () => {
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: { item: candidate, kind: "closed" } })).toBe(
      "closed workspace:1 a-doc — run finished, screen idle",
    );
  });

  it("says would-close on a dry run", () => {
    expect(renderCloseDoneOutcome({ dryRun: true, outcome: { item: candidate, kind: "closed" } })).toBe(
      "would close workspace:1 a-doc — run finished, screen idle",
    );
  });

  it("renders a held row with its screen verdict", () => {
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: { item: candidate, kind: "held", verdict: "busy" } })).toBe(
      "held workspace:1 a-doc — run finished, but screen busy",
    );
  });

  it("renders a drifted row against the row's own ref", () => {
    const outcome: CloseDoneOutcome = {
      item: { kind: "drifted", row: row({ workspaceRef: "workspace:1010" }), workspaceRef: "workspace:1010" },
      kind: "drift-closed",
    };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome })).toBe(
      "closed ledger row workspace:1010 a-doc — workspace already gone",
    );
  });

  const parkItem = {
    kind: "park-candidate" as const,
    row: row() as SessionItem & { slug: string },
    workspace: workspace(),
  };

  it("renders nothing for a working run seat, and a reason for every other kept row", () => {
    const working: CloseDoneOutcome = { item: parkItem, kind: "park-kept", reason: "seat-working" };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: working })).toBeUndefined();
    const busyScreen: CloseDoneOutcome = { item: parkItem, kind: "park-kept", reason: "screen-working" };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: busyScreen })).toBeUndefined();
    const stranger: CloseDoneOutcome = {
      item: parkItem,
      kind: "park-kept",
      reason: "seat-unidentified",
      why: "no Claude Code session runs in its process tree",
    };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: stranger })).toBe(
      "kept workspace:1 a-doc — seat-unidentified: no Claude Code session runs in its process tree",
    );
    const pinned: CloseDoneOutcome = { item: { kind: "kept", reason: "pinned", row: row() }, kind: "kept" };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: pinned })).toBe("kept a-doc — pinned");
  });

  it("renders a park with its draft count, a predecessor close, and a failed park saying whether it journalled", () => {
    const recorded: CloseDoneOutcome = { drafts: 2, how: "recorded", item: parkItem, kind: "parked" };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: recorded })).toBe(
      "parked workspace:1 a-doc — at rest, no shell running; checkpoint journalled with 2 unsent draft(s)",
    );
    expect(renderCloseDoneOutcome({ dryRun: true, outcome: recorded })).toBe(
      "would park workspace:1 a-doc — at rest, no shell running; checkpoint journalled with 2 unsent draft(s)",
    );
    const predecessor: CloseDoneOutcome = { drafts: 0, how: "predecessor", item: parkItem, kind: "parked" };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: predecessor })).toBe(
      "parked workspace:1 a-doc — parked already, its seat was left open; nothing new journalled",
    );
    const failed: CloseDoneOutcome = { item: parkItem, journalled: true, kind: "park-failed", reason: "socket gone" };
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: failed })).toBe(
      "FAILED to park workspace:1 a-doc — socket gone (its checkpoint IS journalled; the seat is still open)",
    );
  });

  it("counts every outcome kind and renders the summary the briefing folds", () => {
    const outcomes: readonly CloseDoneOutcome[] = [
      { item: candidate, kind: "closed" },
      { item: candidate, kind: "held", verdict: "queued" },
      { item: candidate, kind: "close-failed", reason: "pinned" },
      { item: { kind: "drifted", row: row(), workspaceRef: "workspace:1" }, kind: "drift-closed" },
      { item: parkItem, kind: "park-kept", reason: "seat-working" },
      { item: { kind: "kept", reason: "pinned", row: row() }, kind: "kept" },
      { drafts: 1, how: "recorded", item: parkItem, kind: "parked" },
      { item: parkItem, journalled: false, kind: "park-failed", reason: "x" },
    ];
    const counts = countCloseDone({ outcomes });
    expect(counts).toEqual({ closed: 1, driftClosed: 1, failed: 2, held: 1, kept: 2, parked: 1 });
    expect(renderCloseDoneSummary({ dryRun: false, outcomes })).toBe(
      "session close-done: closed 1 done chat(s), parked 1 at-rest seat(s), 1 drifted ledger row(s), held 1 done-but-busy, kept 2 row(s), 2 FAILED",
    );
    expect(renderCloseDoneSummary({ dryRun: true, outcomes: outcomes.slice(0, 2) })).toBe(
      "session close-done: would close 1 done chat(s), would park 0 at-rest seat(s), 0 drifted ledger row(s), held 1 done-but-busy, kept 0 row(s)",
    );
  });
});

describe("renderCloseDoneSummary over reaped dispatch children", () => {
  const reapItem = (evidence: DoneEvidence): CloseDonePlanItem & { readonly kind: "candidate" } => ({
    evidence,
    kind: "candidate",
    row: childRow(),
    workspace: childWorkspace(),
  });

  it("names every reaped child with its evidence, and no held one", () => {
    const outcomes: readonly CloseDoneOutcome[] = [
      { item: reapItem({ kind: "turn-finalised", role: "review", terminal: "answered" }), kind: "closed" },
      { item: reapItem({ kind: "parent-worker-gone" }), kind: "closed" },
      { item: reapItem({ kind: "parent-lease-expired" }), kind: "held", verdict: "busy" },
    ];
    expect(renderCloseDoneSummary({ dryRun: false, outcomes })).toBe(
      `session close-done: closed 2 done chat(s), parked 0 at-rest seat(s), 0 drifted ledger row(s), held 1 done-but-busy, kept 0 row(s) — reaped 2 dispatch child(ren): workspace:9 ${REVIEW_KEY} [review child, answer posted]; workspace:9 ${REVIEW_KEY} [review child, parent worker workspace gone]`,
    );
  });

  it("says would reap on a dry run, and names no child when none was reaped", () => {
    const one: readonly CloseDoneOutcome[] = [{ item: reapItem({ kind: "parent-lease-expired" }), kind: "closed" }];
    expect(renderCloseDoneSummary({ dryRun: true, outcomes: one })).toBe(
      `session close-done: would close 1 done chat(s), would park 0 at-rest seat(s), 0 drifted ledger row(s), held 0 done-but-busy, kept 0 row(s) — would reap 1 dispatch child(ren): workspace:9 ${REVIEW_KEY} [review child, parent lease expired]`,
    );
    expect(renderCloseDoneSummary({ dryRun: false, outcomes: [] })).toBe(
      "session close-done: closed 0 done chat(s), parked 0 at-rest seat(s), 0 drifted ledger row(s), held 0 done-but-busy, kept 0 row(s)",
    );
  });

  it("renders a doc-backed close exactly as it always did — no reap clause", () => {
    const docBacked: CloseDonePlanItem & { readonly kind: "candidate" } = {
      evidence: { kind: "run-closed" },
      kind: "candidate",
      row: row(),
      workspace: workspace(),
    };
    expect(renderCloseDoneSummary({ dryRun: false, outcomes: [{ item: docBacked, kind: "closed" }] })).toBe(
      "session close-done: closed 1 done chat(s), parked 0 at-rest seat(s), 0 drifted ledger row(s), held 0 done-but-busy, kept 0 row(s)",
    );
  });
});
