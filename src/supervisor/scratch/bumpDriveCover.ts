/**
 * Which of a seat's landing repositories a sweep tick drives dependency bumps on itself — the pure half.
 *
 * The tick's landing reading runs `github landing --author @me`, and `@me` excludes every bot's pull request, so a
 * renovate bump is invisible to it by construction. The one thing that drives a bump is `github bump-drive`, fired
 * by a `bump-drive-<repo>` automation row (`../../live/automation/standingRows.ts`). MEASURED: that
 * row was declared by the build and ABSENT from the home's store (`slopweaver automation due` listed it among 24
 * absent rows), so nine open bumps sat unpressed for a day, against the rule that every
 * dependency bump auto-merges.
 *
 * So the tick takes a `github bump-drive` reading for every landing repository whose row will not fire it: the
 * row is absent, present and between firings, or present with a cadence the calculus refuses, which never fires
 * and so is absent in effect. Two shapes keep the tick's hands off. A DUE row is the
 * automation pass's to fire this tick, and a second drive beside it would race the same enqueues and board rows.
 * An OFF row (disabled or held) is a decision somebody recorded, and a tick that drove around it would be
 * overriding that decision on a cadence.
 *
 * No I/O, no clock.
 */
import type { RecipeDefinition } from "../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../live/automation/definitionDue.js";
import { VERB_RUN_KIND } from "../../live/automation/verbRun.js";

/** The verb words a drive row's argv opens with. */
const DRIVE_VERB = ["github", "bump-drive"] as const;

/** The inline spelling of the repository flag. */
const REPO_INLINE = "--repo=";

/** The flag that makes `github bump-drive` a report rather than a drive. */
const DRY_RUN = "--dry-run";

/**
 * Every repository one automation row drives bumps on — none when the row is not a bump drive.
 *
 * Any `verb-run` of `github bump-drive` that names repositories and does not carry `--dry-run`. The argv
 * `bumpDriveRow` declares is `--repo <slug>`, but a hand-registered row may spell it `--repo=<slug>`, list several
 * comma-separated as the verb's own usage allows, or add an output flag such as `--json`, and it drives exactly as
 * hard: matching one exact argv let a disabled or due row in another spelling read as absent, and the tick drove
 * around it. `--dry-run` is the one flag that makes the verb a WORKLIST rather than a drive — the daily `bump-fix`
 * row is that shape — so it alone rules a row out. A row with no `--repo` drives the checkout the automation pass
 * runs in, which the store cannot name, so it covers nothing here.
 *
 * @param definition the stored row, of which only its kind and `params.argv` are read
 * @returns each `owner/name` slug the row names, in its order
 */
export function bumpDriveReposOf({
  definition,
}: {
  definition: Pick<RecipeDefinition, "kind" | "params">;
}): readonly string[] {
  const argv = definition.params["argv"];
  if (definition.kind !== VERB_RUN_KIND || !Array.isArray(argv)) {
    return [];
  }
  const [verb, sub, ...rest] = argv as readonly unknown[];
  if (verb !== DRIVE_VERB[0] || sub !== DRIVE_VERB[1] || rest.includes(DRY_RUN)) {
    return [];
  }
  const value = repoFlagValue({ rest });
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.includes("/"));
}

/** The `--repo` value a drive row's trailing tokens carry, spelled `--repo <v>` or `--repo=<v>`, wherever it sits. */
function repoFlagValue({ rest }: { rest: readonly unknown[] }): string | undefined {
  const at = rest.indexOf("--repo");
  const spaced = at === -1 ? undefined : rest[at + 1];
  if (typeof spaced === "string") {
    return spaced;
  }
  const inline = rest.find((token): token is string => typeof token === "string" && token.startsWith(REPO_INLINE));
  return inline === undefined ? undefined : inline.slice(REPO_INLINE.length);
}

/** One stored drive row and the verdict its own cadence gives it now. */
export interface StoredBumpDrive {
  readonly repo: string;
  /** Why the row's cadence was refused, when it was: such a row is never due and never fires. */
  readonly cadenceError?: string | undefined;
  readonly verdict: Pick<RecipeDueVerdict, "due" | "offReason" | "recipeId">;
}

/** One landing repository and whether this tick drives its bumps. */
export interface BumpDriveCover {
  readonly repo: string;
  /** True when the tick takes a `github bump-drive` reading for it. */
  readonly drive: boolean;
  /** Why, in one clause the digest prints. */
  readonly why: string;
}

/**
 * Decide, per landing repository, whether this tick drives its bumps.
 *
 * Several stored rows naming one repository are judged together: any one due or off keeps the tick out, because
 * either is somebody else's to act on. A slug is matched without regard to case, as GitHub resolves it: a seat
 * spelling `Acme/Widgets` must not read a row stored as `acme/widgets` as absent and drive around it.
 *
 * @param landingRepos the seat's landing repositories, in the order the seat names them
 * @param stored every stored drive row with its verdict
 * @returns one cover per landing repository, in the seat's order
 */
export function bumpDriveCovers({
  landingRepos,
  stored,
}: {
  landingRepos: readonly string[];
  stored: readonly StoredBumpDrive[];
}): readonly BumpDriveCover[] {
  return landingRepos.map((repo) => {
    const rows = stored.filter((row) => row.repo.toLowerCase() === repo.toLowerCase());
    if (rows.length === 0) {
      return { drive: true, repo, why: "no bump-drive row is stored for it" };
    }
    const off = rows.find((row) => row.verdict.offReason !== undefined);
    if (off !== undefined) {
      return { drive: false, repo, why: `${off.verdict.recipeId} is ${String(off.verdict.offReason)}` };
    }
    const due = rows.find((row) => row.verdict.due);
    if (due !== undefined) {
      return { drive: false, repo, why: `${due.verdict.recipeId} is due, so the automation pass fires it` };
    }
    const broken = rows.find((row) => row.cadenceError !== undefined);
    if (broken !== undefined) {
      const why = `${broken.verdict.recipeId}'s cadence was refused (${String(broken.cadenceError)}), so it never fires`;
      return { drive: true, repo, why };
    }
    return { drive: true, repo, why: `${rows.map((row) => row.verdict.recipeId).join(", ")} is between firings` };
  });
}
