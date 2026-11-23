/**
 * `rowCountKey` files a filtered count apart from its table's whole count, so the four measurement roots that
 * share `measurement_location` never report each other's rows.
 */
import { describe, expect, it } from "vitest";

import { rowCountKey } from "../../../../../cli/commands/store/shareRowCounts.js";

describe("rowCountKey", () => {
  it("files an unfiltered count under the table alone", () => {
    expect(rowCountKey({ target: { rowFilter: undefined, table: "door_event" } })).toBe("door_event");
  });

  it("files two filters on one table under two keys", () => {
    const proof = rowCountKey({
      target: { rowFilter: { column: "class", value: "proof" }, table: "measurement_location" },
    });
    const evidence = rowCountKey({
      target: { rowFilter: { column: "class", value: "evidence" }, table: "measurement_location" },
    });
    expect(proof).toBe("measurement_location|class=proof");
    expect(evidence).toBe("measurement_location|class=evidence");
  });
});
