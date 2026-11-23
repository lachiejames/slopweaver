"use client";

import type { ReactElement } from "react";

import { ReadMark, ReadStandIn } from "./LiveMarks";
import { type Atlas, type AtlasSkill, type AtlasTree, readAtlas } from "./readAtlas";
import { useLive } from "./useLive";

/** How many nouns or trees a cell names before it says how many more there are. */
const NAMES_SHOWN = 4;

/**
 * A list of names, capped, with the remainder counted rather than hidden.
 *
 * A shared floor is reached by nearly every noun there is, and printing all of them turns one row into a
 * paragraph. The count is what keeps the cap honest — a reader can see that the cell is a sample.
 *
 * @param names the names, already heaviest first
 * @returns the display string, or an em space when there are none
 */
function capped({ names }: { names: readonly string[] }): string {
  if (names.length === 0) {
    return "none";
  }
  if (names.length <= NAMES_SHOWN) {
    return names.join(", ");
  }
  return `${names.slice(0, NAMES_SHOWN).join(", ")} +${String(names.length - NAMES_SHOWN)}`;
}

/** One tree's row: what lives there, how you enter it, and what governs it. */
function TreeRow({ tree }: { tree: AtlasTree }): ReactElement {
  return (
    <tr>
      <td>
        <code>src/{tree.tree}</code>
        <span className="sw-atlas-count">{tree.modules}</span>
      </td>
      <td>{tree.blurb}</td>
      <td>{capped({ names: tree.entryNouns })}</td>
      <td>{capped({ names: tree.dependsOn })}</td>
      <td>
        {tree.rulePath === undefined ? "no area rule" : <code>{tree.rulePath.replace(".claude/rules/", "")}</code>}
      </td>
    </tr>
  );
}

/** One skill's row: the verb you type, what it is for, and how much reference sits behind it. */
function SkillRow({ skill }: { skill: AtlasSkill }): ReactElement {
  return (
    <tr>
      <td>
        <code>/slopweaver:{skill.name}</code>
        <span className="sw-atlas-count">{skill.referenceFiles}</span>
      </td>
      <td>{skill.blurb}</td>
    </tr>
  );
}

/**
 * Every top-level `src/` tree and every skill, read off this machine rather than transcribed into the page.
 *
 * The table this replaced was hand-written, carried nine of the trees, and had no way of noticing any of the
 * rest. Everything here except each tree's one-line blurb is derived by `slopweaver catalog trees` at
 * the moment you loaded the page, so a tree added this morning is in it and a renamed one cannot linger.
 * The blurbs are declared in `src/canon/codebaseAtlas.ts` and a unit test fails when they stop matching the
 * tree, which is the closest a sentence about a subsystem can get to being derived.
 *
 * **Both tables come from ONE reading, and that is a performance decision rather than a layout one.** The
 * verb reads every non-test `.ts` file under `src/` and takes 6.7s on this machine, so a second component
 * asking for the same slug would walk four thousand files twice on every page load. The skills therefore
 * render here, under their own heading, instead of from a `SkillAtlas` beside this one.
 *
 * No filter box: the console's one text input is the call's chat, so "where does Slack live" is
 * asked there, or found with the browser's own find.
 *
 * @returns the atlas, with the skill surface under it
 */
export function CodebaseAtlas(): ReactElement {
  const state = useLive<Atlas>({ read: readAtlas, slug: "trees" });

  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="the tree on this machine" block />;
  }

  const { trees, skills } = state.value;
  const modules = trees.reduce((total, tree) => total + tree.modules, 0);
  return (
    <div className="sw-catalog">
      <ReadMark state={state} subject="The tree" row />
      <p className="sw-tile-note">
        {String(trees.length)} trees, {String(modules)} modules, {String(skills.length)} skills · derived live by{" "}
        <code>slopweaver catalog trees --json</code>
      </p>
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>tree</th>
            <th>what lives there</th>
            <th>entered by</th>
            <th>imports</th>
            <th>area rule</th>
          </tr>
        </thead>
        <tbody>
          {trees.map((tree) => (
            <TreeRow key={tree.tree} tree={tree} />
          ))}
        </tbody>
      </table>
      <p className="sw-tile-note">
        The command surface is skills, one per verb. The number beside each is how many reference files sit behind its{" "}
        <code>SKILL.md</code>.
      </p>
      <table className="sw-tile-table sw-atlas-table sw-atlas-skills">
        <thead>
          <tr>
            <th>skill</th>
            <th>what it is for</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <SkillRow key={skill.name} skill={skill} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
