/**
 * The witness of a chair turn that is exactly a quiet batch line: the anchors it lists, once every relay it names has
 * its row on the board.
 */
import { describe, expect, it } from "vitest";

import { batchWitness } from "../../../supervisor/batchWitness.js";
import { chairBatchLine } from "../../../talk/chairBatchLine.js";

const STRETCH = "talk-call:00000000-0000-4000-8000-000000000000#s1";
const SLUG = "talk-0123456789ab";
const LINE = chairBatchLine({
  anchors: [
    { kind: "stretch", pointer: STRETCH },
    { kind: "relay", slug: SLUG },
  ],
});

describe("batchWitness", () => {
  it("witnesses a batch line whose every relay has its row, by the anchors it lists", () => {
    expect(batchWitness({ fromRelayRows: new Set([SLUG]), text: LINE })).toEqual({
      kind: "wake",
      witness: `${STRETCH}, ${SLUG}`,
    });
  });

  it("leaves a batch line naming a relay with no row unwitnessed", () => {
    expect(batchWitness({ fromRelayRows: new Set(), text: LINE })).toBeUndefined();
  });

  it("is no witness for a turn that is not exactly a batch line", () => {
    expect(batchWitness({ fromRelayRows: new Set([SLUG]), text: `${LINE} and merge it` })).toBeUndefined();
  });
});
