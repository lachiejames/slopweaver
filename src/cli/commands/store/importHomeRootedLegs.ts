/**
 * The `store import-fleet` legs that read files under the home itself — each walks its own roots from the
 * home rather than from one `stateHomePaths()` field, so `./importFleetRun.ts` dispatches all of them alike.
 */
import type { StoreClient } from "../../../store/client.js";
import { claudeProjectsForHome } from "../../../store/fleet/claudeMemorySync.js";

import { runAuthoredLeg } from "./importAuthoredLeg.js";
import { runFallbackLeg } from "./importFallbackLeg.js";
import type { FleetLeg, LegOutcome } from "./importFleetCore.js";
import { runGrantLeg } from "./importGrantLeg.js";
import { runMeasurementsLeg } from "./importMeasurementsLeg.js";
import { runOwnerTurnsLeg } from "./importOwnerTurnsLeg.js";

/** Each home-rooted leg by name; a leg absent here reads one path the dispatcher resolves for it. */
export const HOME_ROOTED_LEGS: Partial<
  Record<FleetLeg, (args: { client: StoreClient | undefined; home: string }) => Promise<LegOutcome>>
> = {
  // Claude Code's auto-memory is mirrored only into `~/.slopweaver` itself: `~/.claude` belongs to that home, and
  // an import against any other home (a `--home` or `$SLOPWEAVER_HOME` rehearsal, a test) must never read the
  // operator's corpora into it.
  authored: ({ client, home }) => {
    const claudeProjects = claudeProjectsForHome({ home });
    return runAuthoredLeg({ client, home, ...(claudeProjects === undefined ? {} : { claudeProjects }) });
  },
  "codex-fallback": runFallbackLeg,
  grants: runGrantLeg,
  measurements: runMeasurementsLeg,
  "owner-turns": runOwnerTurnsLeg,
};
