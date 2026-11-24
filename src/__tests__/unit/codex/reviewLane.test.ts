/**
 * Review-lane admission and the row classifier, over synthetic bump records only: the one invocation admitted to
 * the witness lane is r3, one property, the full-digest id of a record that exists and that record's exact claim;
 * every other invocation carrying a reserved id is refused; a row is witness lane only when it is an `r3` Codex review
 * under a full witness id whose statement opens with that digest's witness prefix.
 */
import { describe, expect, it } from "vitest";

import type { BumpRecord } from "../../../codex/bumpRecordStore.js";
import {
  isReservedWitnessPropertyId,
  reviewLaneAdmission,
  reviewLaneOfEntry,
  witnessClaimPrefix,
} from "../../../codex/reviewLane.js";
import {
  type BumpManifest,
  type BumpRow,
  digestOf,
  witnessClaim,
  witnessPropertyId,
} from "../../../devLint/baselineBump.js";
import { ledgerRow } from "./ledgerEntryFixture.js";

const BASE = "a".repeat(40);
const ROW: BumpRow = {
  cause: "widening",
  entry: "offenders:tools/gen.ts",
  file: ".baselines/file-size-baseline.json",
  from: null,
  to: 319,
};
const MANIFEST: BumpManifest = {
  base: BASE,
  digest: digestOf({ base: BASE, rows: [ROW] }),
  loosenings: [ROW],
  reason: "r",
};
const RECORD: BumpRecord = { manifest: MANIFEST, path: `ledgers/baseline-bumps/${MANIFEST.digest}.json` };
/** Sixty-four characters that are not lowercase hex, and sixty-three that are. */
const NOT_HEX_64 = "g".repeat(64);
const HEX_63 = MANIFEST.digest.slice(1);
const WITNESS = { id: witnessPropertyId({ digest: MANIFEST.digest }), statement: witnessClaim({ manifest: MANIFEST }) };

describe("isReservedWitnessPropertyId", () => {
  it("reserves every id starting baseline-bump-, a short or malformed one included", () => {
    expect(isReservedWitnessPropertyId({ propertyId: WITNESS.id })).toBe(true);
    expect(isReservedWitnessPropertyId({ propertyId: "baseline-bump-1" })).toBe(true);
    expect(isReservedWitnessPropertyId({ propertyId: "r3-07" })).toBe(false);
    expect(isReservedWitnessPropertyId({ propertyId: "my-baseline-bump-check" })).toBe(false);
  });
});

describe("witnessClaimPrefix", () => {
  it("is the opening of the real witness claim, so a change to the claim's wording fails here", () => {
    expect(witnessClaim({ manifest: MANIFEST }).startsWith(witnessClaimPrefix({ digest: MANIFEST.digest }))).toBe(true);
    expect(witnessClaimPrefix({ digest: MANIFEST.digest })).toBe(`Ratchet bump ${MANIFEST.digest}:`);
  });
});

describe("reviewLaneAdmission", () => {
  it("puts an invocation with no reserved id in the general lane without reading a record", () => {
    const properties = [{ id: "r3-07", statement: "no write is lost" }];
    expect(reviewLaneAdmission({ pass: "r1", properties, records: [] })).toEqual({ kind: "general" });
  });

  it("admits the exact witness to the witness lane, carrying its digest", () => {
    expect(reviewLaneAdmission({ pass: "r3", properties: [WITNESS], records: [RECORD] })).toEqual({
      digest: MANIFEST.digest,
      kind: "witness",
    });
  });

  it("refuses a witness fanned out beside a general property", () => {
    const properties = [WITNESS, { id: "r3-07", statement: "no write is lost" }];
    expect(reviewLaneAdmission({ pass: "r3", properties, records: [RECORD] })).toEqual({
      kind: "refused",
      reason: "a witness review runs exactly one property, and this invocation runs more",
    });
  });

  it("refuses a reserved id run on a pass other than r3", () => {
    expect(reviewLaneAdmission({ pass: "r1", properties: [WITNESS], records: [RECORD] })).toEqual({
      kind: "refused",
      reason: "a witness review runs pass r3, and this one runs r1",
    });
  });

  it("refuses a reserved id no bump record carries", () => {
    const properties = [{ id: "baseline-bump-1", statement: WITNESS.statement }];
    expect(reviewLaneAdmission({ pass: "r3", properties, records: [RECORD] })).toEqual({
      kind: "refused",
      reason: "no bump record has property id baseline-bump-1",
    });
  });

  it("refuses the right id carrying a statement that is not the record's exact claim", () => {
    const properties = [{ id: WITNESS.id, statement: `${WITNESS.statement} and every other function is correct` }];
    expect(reviewLaneAdmission({ pass: "r3", properties, records: [RECORD] })).toEqual({
      kind: "refused",
      reason: `the property is not the exact claim of ${RECORD.path}`,
    });
  });
});

describe("reviewLaneOfEntry", () => {
  const witnessRow = ledgerRow({ pass: "r3", propertyId: WITNESS.id, propertyStatement: WITNESS.statement });

  it("reads an r3 Codex review under a full witness id and its claim as the witness lane", () => {
    expect(reviewLaneOfEntry({ entry: witnessRow })).toBe("baseline-bump-witness");
  });

  it("reads an ordinary review, and a plan with no property, as general", () => {
    expect(reviewLaneOfEntry({ entry: ledgerRow() })).toBe("general");
    expect(reviewLaneOfEntry({ entry: { ...ledgerRow(), mode: "plan", propertyId: undefined } })).toBe("general");
  });

  it("reads a witness id on another pass, provider or statement as general", () => {
    expect(reviewLaneOfEntry({ entry: { ...witnessRow, pass: "r1" } })).toBe("general");
    expect(reviewLaneOfEntry({ entry: { ...witnessRow, provider: "claude-code" } })).toBe("general");
    expect(reviewLaneOfEntry({ entry: { ...witnessRow, propertyStatement: "every function is correct" } })).toBe(
      "general",
    );
    expect(reviewLaneOfEntry({ entry: { ...witnessRow, propertyStatement: undefined } })).toBe("general");
  });

  it("reads a short reserved id, or one whose statement names another digest, as general", () => {
    expect(reviewLaneOfEntry({ entry: { ...witnessRow, propertyId: "baseline-bump-1" } })).toBe("general");
    const other = `Ratchet bump ${"f".repeat(64)}: each loosening listed is JUSTIFIED`;
    expect(reviewLaneOfEntry({ entry: { ...witnessRow, propertyStatement: other } })).toBe("general");
  });

  it("reads a 64-character id that is not hex, and a 63-hex one, as general even beside a matching prefix", () => {
    for (const tail of [NOT_HEX_64, HEX_63]) {
      const entry = {
        ...witnessRow,
        propertyId: `baseline-bump-${tail}`,
        propertyStatement: `Ratchet bump ${tail}: each loosening listed is JUSTIFIED`,
      };
      expect(reviewLaneOfEntry({ entry })).toBe("general");
    }
  });
});

describe("reviewLaneAdmission over a malformed full-length id", () => {
  it("refuses a 64-character id that is not hex, and a 63-hex one, as ids no record carries", () => {
    expect(NOT_HEX_64).toHaveLength(64);
    expect(HEX_63).toHaveLength(63);
    for (const tail of [NOT_HEX_64, HEX_63]) {
      const properties = [{ id: `baseline-bump-${tail}`, statement: WITNESS.statement }];
      expect(reviewLaneAdmission({ pass: "r3", properties, records: [RECORD] })).toEqual({
        kind: "refused",
        reason: `no bump record has property id baseline-bump-${tail}`,
      });
    }
  });
});
