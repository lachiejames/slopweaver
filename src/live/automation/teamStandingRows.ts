/**
 * The standing rows ONE registered team repository declares — a template, so no team repository is compiled into
 * this build.
 *
 * An install registers a repository with `slopweaver automation register-standing --repo <owner/name>`, which
 * writes `$SLOPWEAVER_HOME/live/recipe/team-repositories.json` (`./teamRepositoryStore.ts`).
 * `./declaredStandingRows.ts` then builds each registration's rows here and declares them beside the generic ones,
 * so a registered repository's deleted row is as loud as a generic row's, and a fresh home declares none.
 *
 * **A vulnerability-fix top-up is never declared here.** Its cadence, cap, merge-release threshold, post shape and
 * seat instructions are one installation's policy, so an install writes it as an ordinary `verb-run` definition
 * under `$SLOPWEAVER_HOME/live/recipe/definitions/` carrying those flags (`skills/vulnerability-fix/reference/the-flywheel.md`).
 *
 * **The recipe id is keyed on the repository NAME, never the owner** — the lower-case segment after the `/`. That
 * is what an install's existing rows were written under (`bump-drive-acme-admin` for `acme/acme-admin`), so a
 * registration adopts them as present rather than minting a second row beside each. Two registered repositories
 * sharing a name would collide on every id, so the registry refuses that rather than invent a second id scheme.
 *
 * Pure: a registration in, rows out, no filesystem.
 */
import { standingErrorTrackingRow } from "./standingErrorTrackingRows.js";
import type { StandingRow } from "./standingRow.js";
import { bumpDriveRow } from "./standingRows.js";

/** One team repository an install has registered. */
export interface TeamRepositoryRegistration {
  /** Canonical lower-case `owner/name`. */
  readonly repository: string;
}

/**
 * The key a repository's recipe ids carry: the lower-case name after the `/`.
 *
 * @param repository canonical `owner/name`
 * @returns the name segment, lower-cased
 */
export function teamRepositoryName({ repository }: { readonly repository: string }): string {
  const slash = repository.indexOf("/");
  return repository.slice(slash + 1).toLowerCase();
}

/**
 * Every standing row one registered team repository declares, in a fixed order: the four-hourly bump drive and the
 * weekly Error Tracking batch.
 *
 * @param repository canonical lower-case `owner/name`
 * @returns the declared rows
 */
export function teamStandingRows({ repository }: TeamRepositoryRegistration): readonly StandingRow[] {
  const name = teamRepositoryName({ repository });
  const drive = bumpDriveRow({
    cadence: "30 */4 * * *",
    recipeId: `bump-drive-${name}`,
    repo: repository,
    why:
      `the owner's standing ruling puts every dependency bump in a repository they work in on this lane, and nothing ` +
      `else presses one in ${repository} — without this row a mergeable bump there waits on somebody pressing it`,
  });
  return [drive, standingErrorTrackingRow({ repositoryName: name })];
}
