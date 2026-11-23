import { describe, expect, it } from "vitest";

import { evidenceRetractionVerdict } from "../../../hand/evidence.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import type { DocStatus } from "../../../handover/doc.js";
import { unwrap } from "../../../lib/result.js";

/** A posted step naming the store-backup row, or no row at all. */
function step({ row }: { row: string | undefined }): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "store-backup-lease",
        postedBy: "workspace:12",
        postedIso: "2026-09-27T01:24:20.168Z",
        row,
        unblocks: "the store-backup repair",
        what: "Sign in to Google Cloud so the backup can upload",
        witness: "slopweaver hand done store-backup-lease",
      },
    }),
  );
}

const ROW = "store-backup-daily-stopped-firing-the-pass-643";

describe("evidenceRetractionVerdict — a card leaves when its row finishes", () => {
  it.each<DocStatus>(["done", "cancelled", "rejected"])("settles on the terminal status %s, naming it", (status) => {
    expect(evidenceRetractionVerdict({ status, step: step({ row: ROW }) })).toEqual({
      did: `retracted by evidence — row ${ROW} is ${status}, no hand touched it`,
      kind: "settle",
    });
  });

  it.each<DocStatus>(["draft", "ready", "in-progress", "paused", "unknown"])(
    "keeps on the open status %s",
    (status) => {
      expect(evidenceRetractionVerdict({ status, step: step({ row: ROW }) })).toEqual({ kind: "keep" });
    },
  );

  it("keeps a step that names no row, even handed a terminal status", () => {
    expect(evidenceRetractionVerdict({ status: "done", step: step({ row: undefined }) })).toEqual({ kind: "keep" });
  });
});
