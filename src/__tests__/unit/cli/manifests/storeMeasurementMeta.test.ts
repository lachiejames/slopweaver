/**
 * The three `store measurement-*` rows, split out of the store manifest: the store manifest carries all three,
 * and only `measurement-restore` writes anything.
 */
import { describe, expect, it } from "vitest";

import { storeManifest } from "../../../../cli/manifests/store.js";
import { measurementVerbs } from "../../../../cli/manifests/storeMeasurementMeta.js";

describe("measurementVerbs", () => {
  it("is spread whole into the store manifest", () => {
    expect(Object.keys(measurementVerbs).toSorted()).toEqual([
      "measurement-list",
      "measurement-restore",
      "measurement-show",
    ]);
    expect(Object.keys(measurementVerbs).filter((verb) => storeManifest[verb] === undefined)).toEqual([]);
  });

  it("marks restore, the one verb that writes files, as local-state and the two readers as no effect", () => {
    expect(measurementVerbs["measurement-list"]!.meta.effect).toBe("none");
    expect(measurementVerbs["measurement-show"]!.meta.effect).toBe("none");
    expect(measurementVerbs["measurement-restore"]!.meta.effect).toBe("local-state");
  });
});
