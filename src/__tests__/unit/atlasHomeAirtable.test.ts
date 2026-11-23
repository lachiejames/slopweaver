/*
 * The Airtable atlas's generation paths: the four standard paths and all nineteen kind files, hung off whichever
 * atlas root it is handed.
 */
import { describe, expect, it } from "vitest";

import { airtableAtlasPaths } from "../../atlasHomeAirtable.js";

describe("airtableAtlasPaths", () => {
  it("lays the Airtable generation out under the atlas root with all nineteen kind files", () => {
    expect(airtableAtlasPaths({ atlasRoot: "/state/atlas" })).toEqual({
      kinds: {
        base: "/state/atlas/airtable/bases.jsonl",
        comment: "/state/atlas/airtable/comments.jsonl",
        credential: "/state/atlas/airtable/credentials.jsonl",
        enterprise: "/state/atlas/airtable/enterprise-accounts.jsonl",
        "event-shape": "/state/atlas/airtable/event-shapes.jsonl",
        "export-request": "/state/atlas/airtable/export-requests.jsonl",
        extension: "/state/atlas/airtable/extensions.jsonl",
        field: "/state/atlas/airtable/fields.jsonl",
        group: "/state/atlas/airtable/groups.jsonl",
        interface: "/state/atlas/airtable/interfaces.jsonl",
        method: "/state/atlas/airtable/methods.jsonl",
        page: "/state/atlas/airtable/pages.jsonl",
        person: "/state/atlas/airtable/people.jsonl",
        record: "/state/atlas/airtable/records.jsonl",
        share: "/state/atlas/airtable/shares.jsonl",
        table: "/state/atlas/airtable/tables.jsonl",
        view: "/state/atlas/airtable/views.jsonl",
        webhook: "/state/atlas/airtable/webhooks.jsonl",
        workspace: "/state/atlas/airtable/workspaces.jsonl",
      },
      manifest: "/state/atlas/airtable/manifest.json",
      root: "/state/atlas/airtable",
      sensitive: "/state/atlas/airtable/_sensitive",
      superseded: "/state/atlas/_superseded/airtable",
    });
  });

  it("hangs every path off whichever atlas root it is handed", () => {
    const paths = airtableAtlasPaths({ atlasRoot: "/other-home/atlas" });
    expect(paths.root).toBe("/other-home/atlas/airtable");
    expect(paths.kinds["record"]).toBe("/other-home/atlas/airtable/records.jsonl");
    expect(paths.sensitive).toBe("/other-home/atlas/airtable/_sensitive");
  });
});
