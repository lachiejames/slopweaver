/**
 * The ranked opportunity list the Modules page opens on, with its tail behind a disclosure. A sibling of
 * `./CodebaseHealth.tsx`, which holds the client boundary.
 */
import { type ReactElement, useState } from "react";

import type { HealthOpportunity, CodebaseHealth as HealthReading } from "./readHealth";

/**
 * How many ranked opportunities show before the reader asks for the rest.
 *
 * Every one this tree computes is real and none is dropped, but the list runs to dozens and a page that
 * opens on all of them is a wall of text — rule 7. The rest are one click away. Count them:
 * `slopweaver catalog health --json | jq '.opportunities | length'`.
 */
const RANKED_SHOWN = 12;

/** One ranked gap: what it is, how big, and the command that recomputes it. */
function OpportunityRow({ one }: { one: HealthOpportunity }): ReactElement {
  return (
    <tr>
      <td>
        <span className="sw-atlas-count">{one.kind}</span>
      </td>
      <td>{one.headline}</td>
      <td>
        <code>{one.command}</code>
      </td>
    </tr>
  );
}

/**
 * The ranked opportunity list — what this page is FOR.
 *
 * First on the page deliberately. Everything under it is the evidence for a row in it, and a reader who
 * stops after this section has still got the answer.
 *
 * @param health the reading
 * @returns the ranked list, with the tail behind a disclosure
 */
export function Ranked({ health }: { health: HealthReading }): ReactElement {
  const [all, setAll] = useState(false);
  let shown = health.opportunities.slice(0, RANKED_SHOWN);
  if (all) {
    shown = [...health.opportunities];
  }
  return (
    <div className="sw-catalog">
      <p className="sw-tile-note">
        {String(health.opportunities.length)} ranked by blast radius (files or sites affected, not by how easy each one
        is). Derived live by <code>slopweaver catalog health --json</code>.
      </p>
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>kind</th>
            <th>what it is</th>
            <th>recompute with</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((one) => (
            <OpportunityRow key={`${one.kind}:${one.subject}`} one={one} />
          ))}
        </tbody>
      </table>
      {health.opportunities.length > RANKED_SHOWN && (
        <button
          className="sw-catalog-filter"
          type="button"
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? `show the top ${String(RANKED_SHOWN)} only` : `show all ${String(health.opportunities.length)}`}
        </button>
      )}
    </div>
  );
}
