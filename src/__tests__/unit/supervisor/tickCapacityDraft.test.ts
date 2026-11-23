/**
 * `./tickCapacityDraft.ts` directly: the capacity mapper and the seat-ceiling fold, over the cases the whole
 * draft (`src/__tests__/unit/supervisor/tickDraftSources/capacity.test.ts` and
 * `src/__tests__/unit/supervisor/tickDraftSources/seatCeiling.test.ts`) does not reach — an incomplete capacity
 * reading with a ceiling beside it.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { capacityObservation, withSeatCeiling } from "../../../supervisor/tickCapacityDraft.js";
import { capacityFactsSchema } from "../../../supervisor/tickCapacitySchema.js";
import type { DraftFrame } from "../../../supervisor/tickDraftShapes.js";

const FRAME: DraftFrame = { capturedIso: "2026-10-05T01:05:00.000Z", startedIso: "2026-10-05T01:00:00.000Z" };

/** A seat-ceiling capture measured at the tick's own capture instant. */
const MEASURED_FOUR = {
  document: { ceiling: { kind: "measured", seats: 4 }, toIso: FRAME.capturedIso },
  path: "seat-ceiling.json",
};

describe("capacityObservation", () => {
  it("reads a hold on the disk floor alone as a hold naming disk", () => {
    const capacity = unwrap(
      capacityObservation({
        capture: {
          document: {
            diskFreeGb: 24,
            diskHoldFreeGb: 44.8,
            dispatch: { backoffSeconds: 0, covering: 0, open: 0, subject: "" },
            hold: true,
            holdSubjects: ["disk"],
            load: { load1: 4 },
            segmentsPct: 10,
            swapfileCount: 1,
            topForeign: { footprintGb: 1.5, label: "mds" },
            verdict:
              "machine capacity: HOLD on disk (disk 24.0 GB free (df, Finder shows at least this), hold below 44.8 GB — " +
              "a 5.6 GB seat tree each for the 6-seat boots burst, the next and one spare)",
          },
          path: "capacity.json",
        },
        frame: FRAME,
      }),
    );

    expect(capacity).toMatchObject({
      facts: { diskFreeGb: 24, diskHoldFreeGb: 44.8, hold: true, holdSubjects: ["disk"] },
      status: "read",
    });
  });
});

describe("withSeatCeiling", () => {
  it("leaves an incomplete capacity reading unavailable, with no ceiling folded into facts it does not have", () => {
    const capacity = unwrap(
      capacityObservation({
        capture: {
          document: { hold: false, holdSubjects: [], verdict: "machine capacity: OK" },
          path: "capacity.json",
        },
        frame: FRAME,
      }),
    );

    const folded = unwrap(withSeatCeiling({ capacity, captures: { seatCeiling: MEASURED_FOUR }, frame: FRAME }));

    expect(folded).toStrictEqual(capacity);
    expect(folded.status).toBe("unavailable");
  });
});

describe("capacityFactsSchema", () => {
  /** A tick row's capacity facts with the stated seat ceiling. */
  const factsWith = ({ workingSeatCeiling }: { workingSeatCeiling: unknown }): unknown => ({
    dispatchBackoffSeconds: 0,
    dispatchCovering: 0,
    dispatchOpen: 0,
    dispatchSubject: "",
    hold: false,
    holdSubjects: [],
    load1: 4,
    segmentsPct: 10,
    swapfileCount: 1,
    topForeignGb: 1.5,
    topForeignLabel: "mds",
    workingSeatCeiling,
  });

  it("reads a row's measured seat ceiling and an unmeasurable one's reason back", () => {
    expect(
      capacityFactsSchema.safeParse(factsWith({ workingSeatCeiling: { kind: "measured", seats: 6 } })).success,
    ).toBe(true);
    expect(
      capacityFactsSchema.safeParse(factsWith({ workingSeatCeiling: { kind: "unmeasurable", reason: "no burn" } }))
        .success,
    ).toBe(true);
  });

  it("refuses a seat ceiling carrying the runway the row never keeps", () => {
    const parsed = capacityFactsSchema.safeParse(
      factsWith({ workingSeatCeiling: { kind: "measured", plans: [], seats: 6 } }),
    );

    expect(parsed.success).toBe(false);
  });
});
