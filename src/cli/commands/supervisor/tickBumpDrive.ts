/**
 * The effectful edge of `supervisor tick open`'s bump drive: read the home's automation rows and their runs, judge
 * each against its own cadence, and hand the pure decision (`../../../supervisor/scratch/bumpDriveCover.ts`) what it
 * needs. Why the tick drives bumps at all is that module's header.
 *
 * Two unreadable stores fail in the direction that writes nothing twice. A definitions directory that cannot be
 * listed cannot tell an absent row from a due or held one, so no repository is driven — and nor is one when a
 * `bump-drive-…` file in it was rejected, since a disabled row that cannot be read would otherwise read as absent.
 * Two hand-built shapes this cannot see, and it reads both as an absent row: a drive row stored under another file
 * name and rejected, whose repository nothing in the rejection names; and a definitions directory that is a dangling
 * symlink, which `definitionStore.ts` reads as absent because it treats every `ENOENT` as a fresh install. Closing
 * the second is that store telling a missing path from a broken one, for every reader. A runs file that is present
 * and unreadable judges every stored drive row as never run, which is DUE, so those repositories are left to the
 * automation pass — exactly what `automation due` itself does with that file. Both print why.
 */
import { judgeRecipeDefinitions } from "../../../live/automation/definitionDue.js";
import {
  lastRecipeRun,
  type RecipeDefinitionRuns,
  readRecipeDefinitionRuns,
} from "../../../live/automation/definitionRunStore.js";
import { loadLiftedRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { latestFiringAtOrBefore } from "../../../live/automation/firingCalculus.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type BumpDriveCover,
  bumpDriveCovers,
  bumpDriveReposOf,
  type StoredBumpDrive,
} from "../../../supervisor/scratch/bumpDriveCover.js";
import { type TickReading, tickReadings } from "../../../supervisor/scratch/tickCapture.js";
import type { TickSeat } from "../../../supervisor/tickSeat.js";

/**
 * The file-name prefix every standing drive row is stored under (`bump-drive-<name>.json`). A rejected file
 * carries no readable argv, so its name is the only sign it was a drive row.
 */
const DRIVE_FILE_PREFIX = "bump-drive-";

/** What the tick drives, and every line it owes the chair about the choice. */
export interface TickBumpDriveSelection {
  /** The repositories whose bumps this tick drives, in the seat's order. */
  readonly repos: readonly string[];
  /** One line per landing repository, plus one per store that could not be read. */
  readonly lines: readonly string[];
}

/**
 * Decide which landing repositories this tick drives dependency bumps on, from one home's automation store.
 *
 * @param home the AMBIENT state home every tick reading runs against — never the ledger `--home`
 * @param landingRepos the seat's landing repositories
 * @param nowIso the tick's instant, which each row's cadence is judged against
 * @returns the repositories to drive and the lines saying why each was or was not
 */
export function tickBumpDriveSelection({
  home,
  landingRepos,
  nowIso,
}: {
  home: string;
  landingRepos: readonly string[];
  nowIso: string;
}): TickBumpDriveSelection {
  if (landingRepos.length === 0) {
    return { lines: [], repos: [] };
  }
  const roster = loadLiftedRecipeDefinitions({ home });
  if (roster.directoryError !== null) {
    return {
      lines: [
        `bump-drive: driving no repository — ${roster.directoryError}, so an absent row cannot be told from a due one`,
      ],
      repos: [],
    };
  }
  const unreadDrives = roster.rejected.filter((rejected) => rejected.file.startsWith(DRIVE_FILE_PREFIX));
  if (unreadDrives.length > 0) {
    const files = unreadDrives.map((rejected) => rejected.file).join(", ");
    return {
      lines: [
        `bump-drive: driving no repository — ${files} could not be read, so its repository and state are unknown`,
      ],
      repos: [],
    };
  }
  const runsRead = readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson });
  const unreadRuns = runsRead.isErr()
    ? runsRead.error.map((line) => `bump-drive: ${line} — every stored drive row is judged never run, so due`)
    : [];
  const runs: RecipeDefinitionRuns = runsRead.isOk() ? runsRead.value : {};
  const verdicts = judgeRecipeDefinitions({
    definitions: roster.definitions,
    nowIso,
    runFor: ({ recipeId }) => lastRecipeRun({ recipeId, runs }),
  });
  const stored = roster.definitions.flatMap((definition, index): StoredBumpDrive[] => {
    const repos = bumpDriveReposOf({ definition });
    if (repos.length === 0) {
      return [];
    }
    const slot = latestFiringAtOrBefore({ cadence: definition.cadence, nowIso });
    const cadenceError = typeof slot === "string" ? undefined : slot.error;
    return repos.map((repo) => ({ cadenceError, repo, verdict: verdicts[index]! }));
  });
  const covers = bumpDriveCovers({ landingRepos, stored });
  return {
    lines: [...unreadRuns, ...covers.map((cover) => coverLine({ cover }))],
    repos: covers.filter((cover) => cover.drive).map((cover) => cover.repo),
  };
}

/**
 * Every reading `tick open` captures for one seat, its bump drives included, and the lines saying which
 * repositories it drives.
 *
 * @param home the AMBIENT state home, whose automation rows decide: every reading runs against it, and the open's
 *   `--home` names only the ledger they are recorded in
 * @param nowIso the tick's instant
 * @param seat the seat's constants, which name the landing repositories and the loop key
 * @returns the readings, and the lines the digest prints for the drive choice
 */
export function tickOpenReadings({
  home,
  nowIso,
  seat,
}: {
  home: string;
  nowIso: string;
  seat: Pick<TickSeat, "landingRepos" | "loopSessionKey">;
}): { readonly readings: readonly TickReading[]; readonly lines: readonly string[] } {
  const selection = tickBumpDriveSelection({ home, landingRepos: seat.landingRepos, nowIso });
  return {
    lines: selection.lines,
    readings: tickReadings({
      bumpDriveRepos: selection.repos,
      landingRepos: seat.landingRepos,
      loopSessionKey: seat.loopSessionKey,
    }),
  };
}

/** The line one repository's decision prints. */
function coverLine({ cover }: { cover: BumpDriveCover }): string {
  const verdict = cover.drive ? "driven by this tick" : "not driven by this tick";
  return `bump-drive ${cover.repo}: ${verdict} — ${cover.why}`;
}
