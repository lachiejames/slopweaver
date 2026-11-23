"use client";

import { type ReactElement, useMemo } from "react";

import { ReadMark, ReadStandIn } from "./LiveMarks";
import { type CatalogRow, readCatalog } from "./readCatalog";
import { useLive } from "./useLive";

/**
 * The rows before a reading arrives.
 *
 * Hoisted to module scope rather than written as a `[]` literal in the body: a fresh array each render is a
 * fresh `useMemo` dependency, which rebuilds the whole grouping on every re-render.
 */
const NO_ROWS: readonly CatalogRow[] = [];

/**
 * Group the flat catalog by noun, preserving the order the verb printed.
 *
 * @param rows every readable command
 * @returns one entry per noun, each holding its own commands
 */
function byNoun({ rows }: { rows: readonly CatalogRow[] }): readonly (readonly [string, readonly CatalogRow[]])[] {
  const groups = new Map<string, CatalogRow[]>();
  rows.forEach((row) => {
    const held = groups.get(row.noun);
    if (held === undefined) {
      groups.set(row.noun, [row]);
      return;
    }
    held.push(row);
  });
  return [...groups.entries()];
}

/** One command, with the two dispositions that decide whether it is safe to run while reading. */
function Row({ row }: { row: CatalogRow }): ReactElement {
  return (
    <tr>
      <td>
        <code>
          {row.noun} {row.verb}
        </code>
        {row.externalWrite ? <span className="sw-verb-tag sw-verb-write">writes</span> : null}
        {row.createsWorkItem ? <span className="sw-verb-tag sw-verb-item">opens work</span> : null}
      </td>
      <td>{row.summary}</td>
    </tr>
  );
}

/**
 * Every command this install carries, read from the binary rather than transcribed into this page.
 *
 * The whole reason this is live: a hand-written verb list is stale the day it lands, and a stale command
 * reference is a confident lie to whoever reads it next. What renders here is `slopweaver catalog --json`
 * on the machine serving the page, so the surface documented and the surface installed cannot disagree.
 *
 * No filter box: the console's one text input is the call's chat, so a capability is asked
 * for there, or found with the browser's own find.
 *
 * @returns the catalog, grouped by noun
 */
export function VerbCatalog(): ReactElement {
  const state = useLive<readonly CatalogRow[]>({ read: readCatalog, slug: "catalog" });
  const rows = state.phase === "ready" ? state.value : NO_ROWS;
  const groups = useMemo(() => byNoun({ rows }), [rows]);

  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="the verb catalog" block />;
  }

  return (
    <div className="sw-catalog">
      <ReadMark state={state} subject="The verb catalog" row />
      <p className="sw-tile-note">
        {String(state.value.length)} commands, across {String(groups.length)} nouns · read live from{" "}
        <code>slopweaver catalog --json</code>
      </p>
      {groups.map(([noun, commands]) => (
        <section key={noun} className="sw-catalog-noun">
          <h3>
            {noun} <span>{String(commands.length)}</span>
          </h3>
          <table className="sw-tile-table">
            <tbody>
              {commands.map((row) => (
                <Row key={`${row.noun} ${row.verb}`} row={row} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
