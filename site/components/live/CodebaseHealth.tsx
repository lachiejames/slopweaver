"use client";

import type { ReactElement } from "react";

import { Headline, LongFileState, Recompute, shareOf } from "./CodebaseHealthParts";
import { Ranked } from "./CodebaseHealthRanked";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import { type CodebaseHealth as HealthReading, readHealth } from "./readHealth";
import { useLive } from "./useLive";

/** How many rows each supporting table shows. The verb already ranked them; this is the fold, not a filter. */
const ROWS_SHOWN = 10;

/**
 * Everything this page derives about the CODE, ranked list first.
 *
 * @returns the health half of the atlas
 */
export function CodebaseHealth(): ReactElement {
  const state = useLive<HealthReading>({ read: readHealth, slug: "health" });
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="every module, baseline and gate" block />;
  }
  const health = state.value;
  return (
    <div className="sw-catalog">
      <ReadMark state={state} subject="The tree's health" row />
      <Ranked health={health} />
      <h3>Where the tree stands</h3>
      <Recompute filter=".totals, .gates, .length" />
      <Headline health={health} />
      <h3>What the committed ratchets carry</h3>
      <Recompute filter=".debtLists" />
      <p className="sw-tile-note">
        A ratchet only moves on a rebaseline commit, so the trend anchor is each list&apos;s own PREVIOUS change rather
        than a date: a list written once reads &ldquo;first recorded&rdquo;, never a trend of zero.
      </p>
      <p className="sw-tile-note">
        These totals are what each ratchet FROZE, counted over its own scope. They do not have to match the live counts
        above and a difference is not staleness: <code>file-size-ratchet</code> holds the files it baselined, while the
        length row counts every non-test module this page can see, so the two answer different questions.
      </p>
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>gate</th>
            <th>standing</th>
            <th>previously</th>
          </tr>
        </thead>
        <tbody>
          {health.debtLists.map((list) => (
            <tr key={list.gate}>
              <td>
                <code>{list.gate}</code>
              </td>
              <td>{String(list.total)}</td>
              <td>
                {list.previousTotal === undefined
                  ? "first recorded"
                  : `${String(list.previousTotal)} at ${String(list.previousSha)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Naming, and how widely a name recurs</h3>
      <Recompute filter=".repeatedNames" />
      <p className="sw-tile-note">
        A name carried by many files across many trees is not a defect on its own: <code>errors.ts</code> beside its
        domain is the pattern this repo asks for. It is a steer surface: a name spanning most of the tree is one whose
        meaning has to be the same everywhere.
      </p>
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>file name</th>
            <th>files</th>
            <th>trees</th>
          </tr>
        </thead>
        <tbody>
          {health.repeatedNames.slice(0, ROWS_SHOWN).map((one) => (
            <tr key={one.name}>
              <td>
                <code>{one.name}</code>
              </td>
              <td>{String(one.files)}</td>
              <td>{String(one.trees)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Folder splitting</h3>
      <Recompute filter=".folders" />
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>directory</th>
            <th>files directly in it</th>
          </tr>
        </thead>
        <tbody>
          {health.folders.slice(0, ROWS_SHOWN).map((one) => (
            <tr key={one.dir}>
              <td>
                <code>{one.dir}</code>
              </td>
              <td>{String(one.files)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>The longest files</h3>
      <p>
        The longest file here is not the biggest refactor here. A row marked <strong>exempt</strong> carries a marker
        saying its length is the point: a generated surface rebuilt from a capture, or a register whose rows ARE the
        file, and splitting one would serve the number and no reader. The floor records a ceiling it may not grow past;
        what it is not is work. The number in this table is what the file measures TODAY, which is a different number
        from that ceiling: <code>yarn lint --only file-size-ratchet</code> is what compares the two. Every other row is
        debt that has to come down. A row reading <strong>no baseline row</strong> is neither: the committed floor holds
        nothing for it at all, so there is no ceiling to call it frozen at; this column is read off{" "}
        <code>.baselines/file-size-baseline.json</code>, not off the marker.
      </p>
      <Recompute filter=".length.longest" />
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>file</th>
            <th>code lines</th>
            <th>what it is</th>
          </tr>
        </thead>
        <tbody>
          {health.longest.slice(0, ROWS_SHOWN).map((one) => (
            <tr key={one.path}>
              <td>
                <code>{one.path}</code>
              </td>
              <td>{String(one.codeLines)}</td>
              <td>
                <LongFileState one={one} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Every tree, by state rather than by contents</h3>
      <Recompute filter=".trees" />
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>tree</th>
            <th>modules</th>
            <th>reached by a test</th>
            <th>over the {String(health.ownerBar)} bar</th>
            <th>area rule</th>
          </tr>
        </thead>
        <tbody>
          {health.treeRows.map((tree) => (
            <tr key={tree.tree}>
              <td>
                <code>src/{tree.tree}</code>
              </td>
              <td>{String(tree.modules)}</td>
              <td>{shareOf({ part: tree.reachedByTest, whole: tree.modules })}</td>
              <td>{String(tree.overOwnerBar)}</td>
              <td>
                {tree.rulePath === undefined ? (
                  "no area rule"
                ) : (
                  <code>{tree.rulePath.replace(".claude/rules/", "")}</code>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
