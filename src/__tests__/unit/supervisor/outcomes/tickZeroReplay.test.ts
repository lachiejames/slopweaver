/**
 * THE REPLAY — a frozen tick zero, run through the gate that did not exist when it happened.
 *
 * The owner asked for the deviation to be made structurally impossible, and the only honest proof of
 * a gate is the incident it would have caught. So that tick's two documents sit under
 * `../../../fixtures/supervisor/handoff-9263-tick-zero/` — the `supervisor tick-record` draft it recorded, and
 * a `handover reconcile --json` WRITTEN in the shape it read — and the assertions below are about what
 * `judgeSweep` says to them. Both are sanitised captures: an opaque identifier in either is re-spelled
 * synthetic, and no field an assertion below reads was changed by it.
 *
 * ## What the written reconciliation keeps
 *
 * Every row keeps its list, its position, its priority, kind, grooming and age, and every placement its
 * session and rank, so readiness and the rank band come out as they did. Ids are placeholders (`row-NNNN`)
 * and each label is `Synthetic board row NNNN about …`, naming one matcher per subject outcome the
 * tick's own label matched and no other, so every row sits under exactly the outcomes it sat under then.
 *
 * The outcomes come from the Workstreams register, so the replay KEEPS all twelve synthetic stated outcomes
 * (`../../../statedCandidatesFixture.ts`, one matcher each, the same words the labels carry) through the same keep the
 * console makes (`./keptStatedFixture.ts`) and reads coverage off that register — twelve outcomes standing one for one
 * in place of the ones that tick was held to, read from the one source a tick reads today.
 *
 * ## The one thing the fixture cannot carry, stated rather than worked around
 *
 * A board row's READINESS comes from `handover reconcile`'s own composition of that day's board sections, and
 * the reconciliation document does not carry it — it landed with this change. The board itself has moved on,
 * so those sections are not recoverable. The replay therefore takes readiness from the evidence the
 * document DOES carry: a row no live session in it is on is treated as available work. That is the reading
 * the tick itself had, and it is named here because a replay that quietly invented a field would be proving
 * something about this test rather than about that tick.
 *
 * ## Why the refusal names a superset
 *
 * The labels the outcome sets were taken from were already CUT to 160 characters, the same cut the successor
 * summary makes. That cut can only ever REMOVE a row from an outcome — a matcher hitting late in a board
 * summary no longer hits — so the refusal below names a SUPERSET: MEASURED against the uncut document, that
 * tick left the outcomes standing as `acme-notion-included` and `acme-stalled-prs-handled` unattended, and three more read as
 * unattended here only because the cut took their live session's row out of them. The two that matter are
 * asserted by name, and the superset is asserted as a whole so a change that empties it reddens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { outcomeFields } from "../../../../cli/commands/handover/reconcileOutcomes.js";
import type { BoardRow } from "../../../../handover/rank.js";
import type { PlacedWork } from "../../../../handover/reconcile.js";
import { coverageOutcomes, outcomeCoverage } from "../../../../supervisor/outcomes/coverage.js";
import { judgeSweep } from "../../../../supervisor/outcomes/sweepGate.js";
import { SYNTHETIC_STATED } from "../../../statedCandidatesFixture.js";

import { keptStated } from "./keptStatedFixture.js";

/** Where the two frozen documents live. */
const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "supervisor", "handoff-9263-tick-zero");

/** One frozen document. */
function fixture({ name }: { name: string }): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE, name), "utf8")) as Record<string, unknown>;
}

/** The row shape the frozen reconciliation carries, before readiness is decided. */
interface FrozenRow {
  readonly id: string;
  readonly label: string;
  readonly priority: BoardRow["priority"];
  readonly kind: BoardRow["kind"];
  readonly groomed: boolean;
  readonly waitingHours: number;
  /** Frozen as `null` or `""` where the instant was unknown. */
  readonly openedIso: string | null | undefined;
}

/** One frozen placement. */
interface FrozenPlacement {
  readonly session: string;
  readonly rank: number;
  readonly row: FrozenRow;
}

/** Every row the frozen document carries, deduplicated by id, in the order it lists them. */
function frozenRows({ document }: { document: Record<string, unknown> }): readonly FrozenRow[] {
  const placements = ["aligned", "misaligned", "unprioritised"].flatMap(
    (key) => document[key] as readonly FrozenPlacement[],
  );
  const bare = ["top", "starving", "staleAsks"].flatMap((key) => document[key] as readonly FrozenRow[]);
  const byId = new Map<string, FrozenRow>();
  for (const row of [...placements.map((item) => item.row), ...bare]) {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

/** All twelve synthetic stated outcomes, kept through the console's own keep. */
const KEPT = keptStated({ ids: SYNTHETIC_STATED.map((one) => one.id) });

/**
 * The stated outcome a kept entry came from, read off the `mined:<id>` tag its keep wrote: a keep names the entry off
 * the candidate's title, so the stated id is how the outcome is still recognised.
 */
const STATED_ID_OF = new Map(
  KEPT.map((one) => {
    const tag = (one.detail["tags"] as readonly string[]).find((each) => each.startsWith("mined:"))!;
    return [one.id, tag.slice("mined:".length)];
  }),
);

/** That tick's live sessions, as it resolved them. */
function frozenPlacements({ document }: { document: Record<string, unknown> }): readonly FrozenPlacement[] {
  return ["aligned", "misaligned", "unprioritised"].flatMap((key) => document[key] as readonly FrozenPlacement[]);
}

/**
 * One frozen row given the standing its readiness implies.
 *
 * The fixture predates `standing`, and readiness is the only thing this replay turns on — so an unready row
 * is given `in-flight`, which is what a row somebody was working composed to on the tick being replayed. It
 * predates `ruled` too, and its order is already frozen, so every row reads unruled. And it froze an unknown
 * `openedIso` as `null` or `""`, which today's emitter never writes — it leaves the field `undefined`, which JSON drops
 * — so an unknown instant reads `undefined` here, the way the strict coverage reader expects it.
 *
 * @param row the frozen row, missing every field added since the tick was cut
 * @param ready whether that tick's own fleet left this row unattended
 * @returns the row, with `standing` and `ready` agreeing
 */
function readied({ row, ready }: { row: FrozenRow; ready: boolean }): BoardRow {
  const openedIso = typeof row.openedIso === "string" && row.openedIso !== "" ? row.openedIso : undefined;
  if (ready) {
    return { ...row, openedIso, ready: true, ruled: false, standing: "ready" };
  }
  return { ...row, openedIso, ready: false, ruled: false, standing: "in-flight" };
}

/** The reconciliation as it would look today: every frozen row, with readiness read off the tick's own fleet. */
function reconciliationWithCoverage(): Record<string, unknown> {
  const document = fixture({ name: "reconcile.json" });
  const placements = frozenPlacements({ document });
  const worked = new Set(placements.map((item) => item.row.id));
  const ranked: readonly BoardRow[] = frozenRows({ document }).map((row) =>
    readied({ row, ready: !worked.has(row.id) }),
  );
  const placed: readonly PlacedWork[] = placements.map((item) => ({
    rank: item.rank,
    row: readied({ ready: false, row: item.row }),
    session: item.session,
  }));
  const projection = coverageOutcomes({ workstreams: KEPT });
  const coverage = outcomeCoverage({ botHandles: [], outcomes: projection.outcomes, placed, ranked });
  return {
    ...document,
    ...outcomeFields({
      coverage: {
        outcomeSource: { count: coverage.outcomes.length, kind: "present" },
        outcomes: coverage,
        unanchored: projection.unanchored,
      },
    }),
    ready: ranked.filter((row) => row.ready),
  };
}

/**
 * The outcomes that tick left with nobody on them and no reason — the finding, pinned so a change to the
 * register or the matchers that silently empties this list fails rather than quietly reporting a clean tick.
 */
const REFUSED_IDS = [
  "acme-home-data-moved",
  "acme-backfill-current",
  "acme-notion-included",
  "acme-stalled-prs-handled",
  "acme-threads-moved",
];

/** The two the UNCUT document named — the finding the label cut cannot have manufactured. */
const UNCUT_REFUSED_IDS = ["acme-notion-included", "acme-stalled-prs-handled"];

describe("a frozen tick zero, replayed through the sweep gate", () => {
  it("carries the readings the deviation was made on: capacity free, one spawn, and no outcome judgement", () => {
    const draft = fixture({ name: "draft.json" });
    const sources = draft["sources"] as Record<string, Record<string, Record<string, unknown>>>;
    const actions = draft["actions"] as readonly { readonly kind: string; readonly subject: { readonly id: string } }[];
    const judgements = draft["judgements"] as readonly { readonly kind: string }[];

    expect(sources["capacity"]!["facts"]!["hold"]).toBe(false);
    expect(sources["capacity"]!["facts"]!["load1"]).toBe(8.68);
    expect(actions.filter((action) => action.kind === "spawned").map((action) => action.subject.id)).toEqual([
      "gold-owed-677-cq265-c1-plan-half-capped",
    ]);
    expect(judgements.map((judgement) => judgement.kind)).toEqual(["watch-disposition"]);
  });

  it("REFUSES that draft, naming the outcomes of theirs that the shift left with nobody on them", () => {
    const draft = fixture({ name: "draft.json" });

    const verdict = judgeSweep({
      actions: draft["actions"],
      judgements: draft["judgements"],
      reconciliation: reconciliationWithCoverage(),
      sources: draft["sources"],
    });

    expect(verdict.kind).toBe("refused");
    const refused = verdict as Extract<typeof verdict, { kind: "refused" }>;
    expect([KEPT.length, STATED_ID_OF.size]).toEqual([12, 12]);
    expect(refused.outcomes.map((outcome) => STATED_ID_OF.get(outcome.id))).toEqual(REFUSED_IDS);
    expect(REFUSED_IDS).toEqual(expect.arrayContaining(UNCUT_REFUSED_IDS));
    expect(refused.outcomes.every((outcome) => outcome.unspawned > 0)).toBe(true);
    expect(refused.outcomes.every((outcome) => outcome.anchor.startsWith("transcript:"))).toBe(true);
  });

  it("clears the same tick once it records a hold rationale naming every outcome, which is all it ever owed", () => {
    const draft = fixture({ name: "draft.json" });

    const verdict = judgeSweep({
      actions: draft["actions"],
      judgements: [
        ...(draft["judgements"] as readonly unknown[]),
        {
          claim:
            "load 8.68 against a 22 hold, but every Claude plan is inside its five-hour window; filling further buys refusals",
          judgementId: "h9263-t0-j2",
          kind: "hold-rationale",
          recordedIso: "2026-09-14T11:07:35Z",
          subject: { id: "all-outcomes", kind: "outcome", label: "every standing outcome" },
          whyNotDerived: "operational-context",
          witness: { kind: "command", ref: "gauge9263-0.json" },
        },
      ],
      reconciliation: reconciliationWithCoverage(),
      sources: draft["sources"],
    });

    expect(verdict.kind).toBe("clean");
  });

  it("refuses the same draft against a reconciliation with no coverage at all, rather than passing it", () => {
    const draft = fixture({ name: "draft.json" });

    const verdict = judgeSweep({
      actions: draft["actions"],
      judgements: draft["judgements"],
      reconciliation: fixture({ name: "reconcile.json" }),
      sources: draft["sources"],
    });

    expect(verdict.kind).toBe("unreadable");
    expect((verdict as Extract<typeof verdict, { kind: "unreadable" }>).why).toContain(
      "the reconciliation names no `outcomeSource`",
    );
  });
});
