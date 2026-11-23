import type { ReactElement } from "react";

import type { PlacementOrganisationError } from "../../lib/placementOrganisation";
import { PlainWhy } from "./RawFold";

/**
 * What a root layout draws in place of its pages when the organisation could not be read: the refusal, its exact
 * sentence, and the one command that fixes it. Opaque, on the theme's own ground and ink, so it reads the same in the
 * console window and on the voice overlay's transparent one.
 *
 * @param error why there is no organisation
 * @returns the refusal
 */
export function OrganisationRefusal({ error }: { error: PlacementOrganisationError }): ReactElement {
  return (
    <main className="mx-auto my-16 max-w-2xl rounded-lg bg-background p-4 font-sans text-foreground">
      <h1>Organisation required</h1>
      <p>The console places every row by the organisation this install works for, and it could not read one:</p>
      {/* Said plainly, the raw message folded beneath: a failed read carries the verb's stderr (Codex p2, steer 7). */}
      <div data-organisation-refusal={error.code}>
        <PlainWhy why={error.message} />
      </div>
      <p>
        Write it once with <code>slopweaver org set</code>, then reload.
      </p>
    </main>
  );
}
