/**
 * The Inngest atlas's own paths, in their own module because `atlasHome.ts` had run out of room.
 *
 * That file grows by one function per atlas with no ceiling — it says so itself — and this addition is one of
 * the ones that took it over the 600-code-line `file-size-ratchet` cap. Splitting the newcomer out rather
 * than raising the cap is the intended move, and the JumpCloud atlas reached the same conclusion in the same
 * hour: `atlasHomeShared.ts` is that landing's extraction of the layout both files need, and this module
 * imports it rather than keeping a second copy.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Inngest atlas's paths.
 *
 * Eleven kind files, and the shape of the list is the atlas's own argument: three map the platform — the
 * published REST catalogue's operations, the dashboard's declared routes, and the GraphQL operations only a
 * driven browser can see — and the other eight are this account's own configuration, because
 * `docs/atlas-intent/06-holdings.md`'s test comes out "everything reachable" here. `src/atlas/inngest/model.ts`
 * carries why, including why a run and an event are dispositions rather than kinds.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function inngestAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      app: "apps.jsonl",
      environment: "environments.jsonl",
      "event-key": "event-keys.jsonl",
      "event-type": "event-types.jsonl",
      function: "functions.jsonl",
      "graphql-operation": "graphql-operations.jsonl",
      integration: "integrations.jsonl",
      operation: "operations.jsonl",
      page: "pages.jsonl",
      "signing-key": "signing-keys.jsonl",
      webhook: "webhooks.jsonl",
    },
    platform: "inngest",
  });
}
