/**
 * The Airtable atlas's own paths, in a module of their own rather than in `atlasHome.ts`, so that file sits
 * under the `file-size-ratchet` cap. `atlasHomeGoogle.ts` is the precedent.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Airtable atlas's paths.
 *
 * Nineteen kind files, the most of any atlas here, because Airtable is the "everything reachable" side of
 * `docs/atlas-intent/06-holdings.md`'s test — nothing else in this installation holds a base, a table, a field or a
 * view. `src/atlas/airtable/model.ts` carries why.
 *
 * `sensitive` is resolved like every other platform's and, unlike theirs, is expected to be USED: this is
 * the first atlas whose generation carries a record's actual cells rather than only names.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function airtableAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      base: "bases.jsonl",
      comment: "comments.jsonl",
      credential: "credentials.jsonl",
      enterprise: "enterprise-accounts.jsonl",
      "event-shape": "event-shapes.jsonl",
      "export-request": "export-requests.jsonl",
      extension: "extensions.jsonl",
      field: "fields.jsonl",
      group: "groups.jsonl",
      interface: "interfaces.jsonl",
      method: "methods.jsonl",
      page: "pages.jsonl",
      person: "people.jsonl",
      record: "records.jsonl",
      share: "shares.jsonl",
      table: "tables.jsonl",
      view: "views.jsonl",
      webhook: "webhooks.jsonl",
      workspace: "workspaces.jsonl",
    },
    platform: "airtable",
  });
}
