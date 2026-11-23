/**
 * The layout check `automation retire` makes before its first write: every directory it writes resolves to its own
 * place in the home it was asked about, so a symlink cannot have it change ANOTHER home.
 */
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { operationLockDir, operationLockPath } from "../../../admit/operationLockPath.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../live/automation/failureHoldStore.js";
import { findingDebtDir } from "../../../live/automation/findingDebt.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * A path resolved through its nearest existing ancestor, so a directory not yet created still resolves. An entry that
 * exists but will not resolve — a dangling symlink — answers `null`, since a write through it lands somewhere unknown.
 */
function resolveThroughAncestor({ path }: { readonly path: string }): string | null {
  let entryExists = true;
  try {
    lstatSync(path);
  } catch {
    entryExists = false;
  }
  if (entryExists) {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  }
  const parent = dirname(path);
  if (parent === path) {
    return path;
  }
  const resolvedParent = resolveThroughAncestor({ path: parent });
  if (resolvedParent === null) {
    return null;
  }
  return join(resolvedParent, basename(path));
}

/**
 * Refuse a home where any directory this verb writes resolves anywhere but its own place, before anything is read for a write or
 * written.
 *
 * Each directory the verb writes into is checked — the recipe tree, the registry's directory, the definitions it
 * removes, the finding debt it clears and the operation lock it takes — so a symlink at or above any of them into
 * ANOTHER home would have this change that home while only this one asked. Checked at the front, never at the last
 * write, or a refusal would arrive after the first write had landed.
 *
 * **What it defends against, and what it does not.** A home LAID OUT wrong — a link left by a copy, a restore or a
 * hand — is caught. A process of the same user SWAPPING a directory for a link while this verb runs is not: that
 * process could delete the other home's file itself, and every path-addressed writer in the tree shares the gap.
 * Pinning directory identity across the run would need descriptor-relative I/O Node does not offer, so the check is
 * against a static layout, stated here rather than implied.
 *
 * @param home the state home the retirement was asked about
 * @returns the line naming the escape, or `null` when every path stays inside the home
 */
export function recipeTreeEscape({ home }: { readonly home: string }): string | null {
  const recipe = stateHomePaths({ home }).live.recipe;
  const resolvedHome = resolveThroughAncestor({ path: home });
  if (resolvedHome === null) {
    return `the home ${home} does not resolve — nothing changed`;
  }
  const written = [
    recipe.root,
    dirname(recipe.retirementsJson),
    recipe.definitionsDir,
    findingDebtDir({ home }),
    operationLockDir({ home }),
    operationLockPath({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY }),
  ];
  for (const path of written) {
    const resolved = resolveThroughAncestor({ path });
    if (resolved === null) {
      return `${path} exists but does not resolve — nothing changed`;
    }
    // Its own place in the resolved home, exactly: "somewhere under the home" would pass a link into another home
    // nested inside this one, so ANY symlink between the home and a written directory refuses.
    const ownPlace = join(resolvedHome, relative(home, path));
    if (resolved !== ownPlace) {
      return `${path} resolves to ${resolved}, not its own place in this home — nothing changed`;
    }
  }
  return null;
}
