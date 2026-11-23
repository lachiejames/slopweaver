/**
 * The publish gate, and the property it exists for.
 *
 * The gate refused its own first generation because its criterion was a `providerId` prefix and every
 * operation entity begins `GET https://…`. That is the test worth having: the gate must let a full compiled
 * generation through and refuse a single stored detection, and the two cases must be distinguished by
 * something a rename cannot move.
 */
import { describe, expect, it } from "vitest";

import {
  emptyNightfallChannels,
  emptyNightfallKindFile,
  type NightfallAtlasEntity,
} from "../../../../atlas/nightfall/model.js";
import { refuseStoredDetections } from "../../../../atlas/nightfall/store.js";
import { buildNightfallGeneration } from "../../../../atlas/nightfall/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One entity of a given family, with nothing any channel has looked at. */
function entity({ family }: { family: NightfallAtlasEntity["family"] }): NightfallAtlasEntity {
  return { channels: emptyNightfallChannels(), family, id: "e", kind: "violation", providerId: "p" };
}

describe("refuseStoredDetections", () => {
  it("passes the whole compiled generation, all 56 operations included", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    const gate = refuseStoredDetections({ files: generation.files });
    expect(gate.isOk()).toBe(true);
  });

  it("refuses one stored record on a shape-indexed kind, naming the kind and the count", () => {
    const file = {
      ...emptyNightfallKindFile({ kind: "violation", updatedAt: AT }),
      entities: [entity({ family: "record" })],
    };
    const gate = refuseStoredDetections({ files: { violation: file } });
    expect(gate.isErr()).toBe(true);
    expect(gate._unsafeUnwrapErr()).toStrictEqual([
      "violation carries 1 stored record(s) and its disposition is shape-index — docs/atlas-intent/06-holdings.md says this family is reached and its shape stored, never a row per detection",
    ]);
  });

  it("allows a declared record shape on the same kind, because a shape is not a record", () => {
    const file = {
      ...emptyNightfallKindFile({ kind: "violation", updatedAt: AT }),
      entities: [entity({ family: "record-shape" })],
    };
    expect(refuseStoredDetections({ files: { violation: file } }).isOk()).toBe(true);
  });

  it("allows a stored record on a kind whose disposition is entity", () => {
    const file = {
      ...emptyNightfallKindFile({ kind: "mcp-server", updatedAt: AT }),
      entities: [{ ...entity({ family: "record" }), kind: "mcp-server" as const }],
    };
    expect(refuseStoredDetections({ files: { "mcp-server": file } }).isOk()).toBe(true);
  });
});
