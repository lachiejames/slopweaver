/**
 * The two standing rows whose subject is THIS repository — the four-hourly bump drive and the daily seated bump fix.
 *
 * Their ids are stable and their `--repo` is one install's fact: `./ownRepository.ts` reads it from the declared main
 * checkout's `origin`. MEASURED, the compiled-in address is not always that repository: `github bump-drive`
 * read `No dependency bumps among the 0 open pull request(s)` on a schedule, because GitHub answered 422 for it, while
 * the checkout's own origin held three open bumps. Repro: `slopweaver github bump-drive --repo <the row's slug> --dry-run`.
 *
 * **`--repo` stays named rather than inherited**, for the reason `./standingRows.ts`'s `bumpDriveRow` gives: only its
 * VALUE moved out of the build, so the subject is still a property of the schedule rather than of where a session
 * stood.
 *
 * Pure: a slug in, rows out.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "./definition.js";
import { BUMP_FIX_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";
import { bumpDriveRow } from "./standingRows.js";

/** The stable id of the four-hourly drive, which a stored row is keyed by whatever the repository's address. */
export const BUMP_DRIVE_OWN_RECIPE_ID = "bump-drive-slopweaver";

/** The stable id of the daily seated fix. */
export const BUMP_FIX_OWN_RECIPE_ID = "bump-fix-slopweaver";

/** The drive on this repository, whose renovate bumps open as DRAFTS and were invisible to every press. */
function ownBumpDriveRow({ repository }: { readonly repository: string }): StandingRow {
  return bumpDriveRow({
    cadence: "0 */4 * * *",
    recipeId: BUMP_DRIVE_OWN_RECIPE_ID,
    repo: repository,
    why:
      "nothing else drives a renovate bump to a landing: `renovate.json` opens them as DRAFTS and `github " +
      "landing` excludes drafts, so no verb had a word for the one act they need — measured at ten " +
      "open bumps, three of which would have landed the moment somebody undrafted them, the oldest 145 hours old",
  });
}

/**
 * The daily seated session that drives this repository's RED bumps green — the half `bump-drive` cannot do.
 *
 * Dependency bump pull requests are wanted green and merged every 24 hours, every one of them over the line. The
 * four-hourly drive presses what a verb can finish and SEATS the rest — a rebase or a red
 * leg is judgement, so it writes a board row and stops. MEASURED that morning, all ten open bumps planned `seat` and
 * nothing was working any of them. This row is the session that does.
 *
 * **A seated kind, not `verb-run`.** The work is a rebase, a red leg read and fixed, a push and its CI — a
 * visible session's (`AGENTS.md` rule 2), so `./definitionShape.ts` answers `spawn` for {@link BUMP_FIX_KIND}.
 *
 * **`--dry-run` in the argv is the point.** The row's own run is the WORKLIST — every open bump and the one act
 * it needs — written nowhere. A real pass would register a board row per bump it seats, which a second session
 * could pick up while this one is working the same pull request. The seated session runs the real pass itself
 * once nothing is left to fix, and runs this row's claimed `run-due` LAST, so the firing settles only after the
 * work: `skills/automation/reference/bump-fix.md`.
 *
 * **`15 8 * * *`, installation-local.** A cadence reads in the install's own zone (`./definition.ts`), so this
 * is 08:15 the owner's morning — fifteen minutes after the 08:00 four-hourly drive has pressed whatever was ready.
 * **`onMissed: "skip"`**: the next worklist carries every bump a missed day would have.
 */
function ownBumpFixRow({ repository }: { readonly repository: string }): StandingRow {
  return {
    definition: {
      cadence: "15 8 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: BUMP_FIX_KIND,
      onMissed: "skip",
      params: { argv: ["github", "bump-drive", "--repo", repository, "--dry-run"] },
      recipeId: BUMP_FIX_OWN_RECIPE_ID,
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    },
    why:
      "the four-hourly drive presses a bump a verb can finish and only SEATS one that needs a rebase or a red leg " +
      "fixed, so without this row nothing is sure to work them — measured at ten open renovate bumps, " +
      "every one red and every one planned `seat`",
  };
}

/**
 * The two rows on one repository, each superseding its own exact shape on every address an earlier build or pass
 * could have written.
 *
 * The current address is filtered out of the earlier ones, whatever its case: a stored row equal to both its
 * declaration and a `supersedes` shape would read SUPERSEDED on every pass and be rewritten by every one.
 *
 * @param repository the canonical `owner/name` the install's checkout resolves to
 * @param supersededRepositories every address an earlier build or pass may have written into these rows
 * @returns the drive row, then the fix row
 */
export function ownRepositoryStandingRows({
  repository,
  supersededRepositories,
}: {
  readonly repository: string;
  readonly supersededRepositories: readonly string[];
}): readonly StandingRow[] {
  const current = repository.toLowerCase();
  const earlier = supersededRepositories.filter(
    (candidate, index, all) =>
      candidate.toLowerCase() !== current &&
      all.findIndex((other) => other.toLowerCase() === candidate.toLowerCase()) === index,
  );
  const shapes = ({
    build,
  }: {
    readonly build: (args: { readonly repository: string }) => StandingRow;
  }): readonly RecipeDefinition[] => earlier.map((slug) => build({ repository: slug }).definition);
  return [
    { ...ownBumpDriveRow({ repository }), supersedes: shapes({ build: ownBumpDriveRow }) },
    { ...ownBumpFixRow({ repository }), supersedes: shapes({ build: ownBumpFixRow }) },
  ];
}
