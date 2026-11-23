/*
 * `atlasReadJson`'s entities: the derived name and the query witness carried on the wire, and a null name and an empty
 * witness when neither applies.
 */
import { describe, expect, it } from "vitest";

import {
  type AtlasReadEntityJson,
  type AtlasReadJson,
  atlasReadJson,
} from "../../../../../../cli/commands/atlas/readCore.js";
import { answeredWith } from "./harness.js";

/**
 * The entities of a `--json` document that must be a selection.
 *
 * Throws rather than substituting an empty list, so a refusal fails the test that asked for a page
 * instead of passing over zero rows.
 *
 * @param document the document under test
 * @returns its entities
 */
function selectedEntities({ document }: { document: AtlasReadJson }): readonly AtlasReadEntityJson[] {
  if (document.outcome !== "selection") {
    throw new Error(`expected a selection, got ${document.outcome}: ${document.message}`);
  }
  return document.entities;
}

describe("atlasReadJson entities", () => {
  it("carries the derived name and the query witness on the wire", () => {
    const document = atlasReadJson({
      acceptUnproven: false,
      result: answeredWith({
        detail: { name: "acme.com", settings: { label: "Password required" } },
        selection: { query: "password" },
      }),
    });
    const entities = selectedEntities({ document });
    expect(entities[0]!.name).toBe("acme.com");
    expect(entities[0]!.matchedOn).toEqual([
      { alsoIn: 0, excerpt: "Password required", path: "detail.settings.label", token: "password" },
    ]);
  });

  it("carries an empty witness and a null name when neither applies", () => {
    const document = atlasReadJson({
      acceptUnproven: false,
      result: answeredWith({ detail: { keys: 4 }, selection: {} }),
    });
    const entities = selectedEntities({ document });
    expect(entities[0]!.name).toBeNull();
    expect(entities[0]!.matchedOn).toEqual([]);
  });
});
