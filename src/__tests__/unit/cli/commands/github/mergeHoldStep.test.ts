/**
 * The merge hold's step in `github merge`, over an in-memory hold document — no mocks. A real landing refuses on
 * another pull request's hold and notes a stale one; a dry run is told, never stopped, and writes nothing.
 */
import { describe, expect, it } from "vitest";
import type { MergeHoldDeps } from "../../../../../cli/commands/github/holdDeps.js";
import { refusedByHold } from "../../../../../cli/commands/github/mergeHoldStep.js";
import type { SupervisorEvent } from "../../../../../events/event.js";
import { ok } from "../../../../../lib/result.js";
import { measured } from "../../../../../measurement/status.js";
import { DEFAULT_HOLD_STALE_MINUTES, type MergeHold } from "../../../../../outbound/github/mergeHold.js";

const NOW = "2026-08-28T01:05:00.000Z";

/** A hold another session placed on `owner/name` five minutes before `NOW`, for the pull request `HOLD.pr` names. */
const HOLD: MergeHold = {
  atIso: "2026-08-28T01:00:00.000Z",
  holder: "a-session",
  pr: 32,
  repo: "owner/name",
  staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
  staleWarnedAtIso: undefined,
  why: "rebase hell",
};

/** What one step observed: every printed line, every published event, and every document write. */
interface Harness {
  readonly deps: MergeHoldDeps;
  readonly events: SupervisorEvent[];
  readonly lines: string[];
  readonly writes: (readonly MergeHold[])[];
}

/**
 * The hold's edges over a starting document and clock.
 *
 * @param holds the document as it stands before the step
 * @param nowIso the clock the step reads
 * @returns the edges and what the step did through them
 */
function harness({ holds, nowIso }: { holds: readonly MergeHold[]; nowIso: string }): Harness {
  const events: SupervisorEvent[] = [];
  const lines: string[] = [];
  const writes: (readonly MergeHold[])[] = [];
  const deps: MergeHoldDeps = {
    appendLedgerRow: () => ok(undefined),
    holderLive: () => measured({ value: true }),
    nowIso: () => nowIso,
    out: ({ line }) => lines.push(line),
    publish: ({ event }) => events.push(event),
    readHolds: () => holds,
    readLedgerRows: () => [],
    sessionId: () => "this-session",
    writeHolds: ({ holds: next }) => {
      writes.push(next);
      return ok(undefined);
    },
  };
  return { deps, events, lines, writes };
}

/** Run the step for `#number` on `owner/name`, its output sent where the harness records it. */
function step({ h, dryRun, number }: { h: Harness; dryRun: boolean; number: number }): boolean {
  return refusedByHold({
    args: { dryRun, number, repo: "owner/name" },
    deps: { hold: h.deps, out: h.deps.out },
    home: "/home",
  });
}

describe("refusedByHold", () => {
  it("passes silently when no hold stands", () => {
    const h = harness({ holds: [], nowIso: NOW });
    expect(step({ dryRun: false, h, number: 21 })).toBe(false);
    expect(h.lines).toEqual([]);
  });

  it("refuses a landing of another pull request while a hold stands, prefixing every line", () => {
    const h = harness({ holds: [HOLD], nowIso: NOW });
    expect(step({ dryRun: false, h, number: 21 })).toBe(true);
    expect(h.lines).toEqual([
      "refused: a merge hold stands on owner/name: owner/name#32 owns the merge queue, and this invocation is for #21 — placed by a-session at 2026-08-28T01:00:00.000Z (5m ago).",
      "refused: why: rebase hell",
      "refused: wait for owner/name#32 to land, or clear the hold with `slopweaver github release --pr 32 --repo owner/name`.",
      "refused: the hold refuses slopweaver's own landing verbs — `github merge` and `github enqueue`. `gh pr merge`, GitHub's own 'Merge when ready' button and an administrator override still bypass it entirely.",
    ]);
  });

  it("tells a dry run about the same hold as a note, and does not refuse it", () => {
    const h = harness({ holds: [HOLD], nowIso: NOW });
    expect(step({ dryRun: true, h, number: 21 })).toBe(false);
    expect(h.lines[0]).toBe(
      "note: landing preflight only — a merge hold stands on owner/name: owner/name#32 owns the merge queue, and this invocation is for #21 — placed by a-session at 2026-08-28T01:00:00.000Z (5m ago).",
    );
    expect(h.lines.length).toBe(4);
  });

  it("lets the held pull request itself through, unprefixed", () => {
    const h = harness({ holds: [HOLD], nowIso: NOW });
    expect(step({ dryRun: false, h, number: 32 })).toBe(false);
    expect(h.lines).toEqual([
      "merge hold: this IS the held pull request owner/name#32 — placed by a-session at 2026-08-28T01:00:00.000Z (5m ago). It does not block you.",
    ]);
  });

  it("notes a stale hold on a real landing, but a dry run writes and publishes nothing", () => {
    const staleNow = "2026-08-29T01:00:00.000Z";
    const real = harness({ holds: [HOLD], nowIso: staleNow });
    step({ dryRun: false, h: real, number: 21 });
    expect(real.writes.length).toBe(1);
    expect(real.writes[0]![0]!.staleWarnedAtIso).toBe(staleNow);

    const dry = harness({ holds: [HOLD], nowIso: staleNow });
    step({ dryRun: true, h: dry, number: 21 });
    expect(dry.writes).toEqual([]);
    expect(dry.events).toEqual([]);
  });
});
