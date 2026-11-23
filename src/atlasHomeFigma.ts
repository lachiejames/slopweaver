/**
 * The Figma atlas's own paths, in a module of their own rather than in `atlasHome.ts`, so that file sits
 * under the `file-size-ratchet` cap. `atlasHomeGoogle.ts` is the precedent.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Figma atlas's paths.
 *
 * Eighteen kind files, because Figma is the "everything reachable" side of `docs/atlas-intent/06-holdings.md`'s test
 * — nothing else in this installation holds a Figma file, component, style or variable.
 * `src/atlas/figma/model.ts` carries why.
 *
 * Two of the eighteen are fed by no operation at all. `team` and `person` exist because Figma's REST
 * surface returns neither, so both are reachable in the browser and nowhere else; giving each a file is how
 * the atlas says that rather than leaving the same fact to read as an absence nobody noticed.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function figmaAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      comment: "comments.json",
      component: "components.json",
      "component-set": "component-sets.json",
      credential: "credentials.json",
      "dev-resource": "dev-resources.json",
      "event-shape": "event-shapes.json",
      file: "files.json",
      "file-version": "file-versions.json",
      folder: "folders.json",
      method: "methods.json",
      page: "pages.json",
      person: "people.json",
      project: "projects.json",
      reaction: "reactions.json",
      style: "styles.json",
      team: "teams.json",
      variable: "variables.json",
      webhook: "webhooks.json",
    },
    platform: "figma",
  });
}
