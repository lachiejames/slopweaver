/**
 * The reader for `catalog trees --json`, the codebase atlas — moved out of `read.ts` when that file crossed
 * the lint lane's line budget. The rule at the top of `read.ts` applies unchanged: a row that will
 * not parse refuses the whole reading.
 */

import { bags, isBag, num, str, strings } from "../../lib/bag";

/** One top-level `src/` tree, exactly as `catalog trees --json` publishes it. */
export interface AtlasTree {
  readonly tree: string;
  readonly blurb: string;
  readonly modules: number;
  readonly entryNouns: readonly string[];
  /** The `paths:`-scoped area rule governing it; absent on a tree no rule names, which is most of them. */
  readonly rulePath: string | undefined;
  readonly dependsOn: readonly string[];
  readonly dependedOnBy: readonly string[];
}

/** One skill on the command surface. */
export interface AtlasSkill {
  readonly name: string;
  readonly blurb: string;
  readonly referenceFiles: number;
}

/** What the codebase-atlas page renders: the trees and the skills. */
export interface Atlas {
  readonly trees: readonly AtlasTree[];
  readonly skills: readonly AtlasSkill[];
}

/**
 * Project `catalog trees --json` into the codebase-atlas page's shape.
 *
 * A tree or a skill that will not read refuses the WHOLE atlas, per this file's no-dropping rule. This page
 * is the one whose claim is that it lists every tree in `src/`, and the count it prints beside the table
 * would otherwise be the post-drop one — a shorter list that still looks complete is exactly the failure
 * the atlas exists to remove from the hand-written table it replaced.
 *
 * `rulePath` is typed `| undefined` and carried as the absence it is: most trees legitimately have no area
 * rule, so a missing one is a fact about the repository rather than a shape change.
 *
 * @returns the trees and skills, or `undefined` when the payload is not an atlas
 */
export function readAtlas(payload: unknown): Atlas | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const treeRows = bags({ bag: payload, key: "trees" });
  const skillRows = bags({ bag: payload, key: "skills" });
  if (treeRows === undefined || skillRows === undefined) {
    return undefined;
  }
  const trees: AtlasTree[] = [];
  for (const row of treeRows) {
    const tree = str({ bag: row, key: "tree" });
    const blurb = str({ bag: row, key: "blurb" });
    const modules = num({ bag: row, key: "modules" });
    const entryNouns = strings({ bag: row, key: "entryNouns" });
    const dependsOn = strings({ bag: row, key: "dependsOn" });
    const dependedOnBy = strings({ bag: row, key: "dependedOnBy" });
    if (
      tree === undefined ||
      blurb === undefined ||
      modules === undefined ||
      entryNouns === undefined ||
      dependsOn === undefined ||
      dependedOnBy === undefined
    ) {
      return undefined;
    }
    trees.push({
      blurb,
      dependedOnBy,
      dependsOn,
      entryNouns,
      modules,
      rulePath: str({ bag: row, key: "rulePath" }),
      tree,
    });
  }
  const skills: AtlasSkill[] = [];
  for (const row of skillRows) {
    const name = str({ bag: row, key: "name" });
    const blurb = str({ bag: row, key: "blurb" });
    const referenceFiles = num({ bag: row, key: "referenceFiles" });
    if (name === undefined || blurb === undefined || referenceFiles === undefined) {
      return undefined;
    }
    skills.push({ blurb, name, referenceFiles });
  }
  return { skills, trees };
}
