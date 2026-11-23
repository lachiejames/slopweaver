/*
 * A call's offers as its file keeps them: one per offer, in the order they landed, whatever a retried batch wrote
 * twice. The list is the call's audit and a relay's evidence, so a duplicate here is a duplicate there.
 */
import { describe, expect, it } from "vitest";

import { type CallOffer, foldOffer } from "../../../talk/callOffer.js";

/** An `offered` line, parsed, for the offer `offer-<made>`. */
const line = ({ made, atIso, text }: { made: number; atIso: string; text: string }) => ({
  atIso,
  kind: "offered" as const,
  offer: { id: `offer-${String(made)}`, made: String(made), text },
});

describe("foldOffer", () => {
  it("keeps each offer once, in the order they landed, the first copy of a line written twice in its place", () => {
    const offers: CallOffer[] = [];
    foldOffer({ entry: line({ atIso: "2026-10-09T03:00:01.000Z", made: 1, text: "first" }), offers });
    foldOffer({ entry: line({ atIso: "2026-10-09T03:00:02.000Z", made: 2, text: "second" }), offers });
    foldOffer({ entry: line({ atIso: "2026-10-09T03:00:03.000Z", made: 1, text: "first, posted again" }), offers });
    expect(offers).toEqual([
      {
        atIso: "2026-10-09T03:00:01.000Z",
        belowFold: undefined,
        id: "offer-1",
        label: undefined,
        made: "1",
        text: "first",
      },
      {
        atIso: "2026-10-09T03:00:02.000Z",
        belowFold: undefined,
        id: "offer-2",
        label: undefined,
        made: "2",
        text: "second",
      },
    ]);
  });
});
