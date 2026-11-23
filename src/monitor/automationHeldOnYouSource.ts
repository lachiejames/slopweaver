/**
 * The read behind `automation-held-on-you`: every recipe definition on disk, each with the file it came from and its
 * kind's own summary, handed to the pure judge in `./automationHeldOnYou.ts`.
 *
 * Its own read rather than a share of `./stoppedSource.ts`'s: that one joins run stamps and the slot ledger to judge
 * whether a row went QUIET, and a held row is excluded there by construction. An owner hold needs only the definition
 * — no board, since a hold naming no finding has no fix to read — so this read is one directory listing, plus the
 * hand register for the cards the owner already closed (`./heldKeys.ts` § `readClosedByOwner`).
 *
 * Not having looked is never `clear`: a directory that will not list is `unmeasurable`, and a file that will not
 * parse is a blind spot on a firing reading, or `unmeasurable` when nothing else fired, since the held row may be
 * exactly the one that did not parse.
 */
import { loadRecipeDefinitions } from "../live/automation/definitionStore.js";
import { findRecipeKind } from "../live/automation/kinds.js";
import { stateHomePaths } from "../stateHome.js";

import { AUTOMATION_HELD_ON_YOU, evaluateAutomationHeldOnYou } from "./automationHeldOnYou.js";
import { readClosedByOwner } from "./heldKeys.js";
import type { MonitorReading } from "./types.js";

/**
 * Read every definition under the home and judge which stand on the owner's own hold.
 *
 * @param home the Slopweaver home
 * @returns the reading — firing, clear or unmeasurable, never a quiet clear over a read that failed
 */
export function readAutomationHeldOnYou({ home }: { home: string }): MonitorReading {
  const closed = readClosedByOwner({ definition: AUTOMATION_HELD_ON_YOU, home });
  if (closed.isErr()) {
    // Without the card history a hold the owner answered would be re-posted over their Done, so the pass answers nothing.
    return { because: closed.error, monitorId: "automation-held-on-you", state: "unmeasurable" };
  }
  const roster = loadRecipeDefinitions({ board: null, directory: stateHomePaths({ home }).live.recipe.definitionsDir });
  if (roster.directoryError !== null) {
    return {
      because: `the recipe definitions directory could not be listed: ${roster.directoryError}`,
      monitorId: "automation-held-on-you",
      state: "unmeasurable",
    };
  }
  const rows = roster.definitions.map((definition, index) => {
    const kind = findRecipeKind({ kind: definition.kind });
    return {
      definition,
      definitionFile: roster.definitionFiles[index]!,
      kindSummary: kind === undefined ? null : kind.summary,
    };
  });
  const judged = evaluateAutomationHeldOnYou({ closed: closed.value, rows });
  if (roster.rejected.length === 0) {
    return judged;
  }
  const because = `${String(roster.rejected.length)} recipe definition file(s) could not be parsed, so a row held on the owner may be invisible — ${roster.rejected.map((rejection) => `${rejection.file}: ${rejection.error.message}`).join("; ")}`;
  if (judged.state === "firing") {
    return { ...judged, blindSpot: because };
  }
  return { because, monitorId: "automation-held-on-you", state: "unmeasurable" };
}
