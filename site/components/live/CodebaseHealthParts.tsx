/**
 * The headline table and the cells and captions the rest of the Modules page shares: a percentage over a real
 * denominator, the recompute caption, the length row's gap and a long file's state. A sibling of
 * `./CodebaseHealth.tsx`, which holds the client boundary.
 */
import type { ReactElement } from "react";

import type { CodebaseHealth as HealthReading } from "./readHealth";

/**
 * A percentage, rendered only when the denominator is real.
 *
 * @param part the numerator
 * @param whole the denominator
 * @returns the percentage, or an em dash over an empty denominator
 */
export function shareOf({ part, whole }: { part: number; whole: number }): string {
  if (whole === 0) {
    return "not measured";
  }
  return `${String(Math.round((part / whole) * 100))}%`;
}

/**
 * The command that recomputes exactly the section it sits under.
 *
 * The ranked rows already carry one each, and the owner set that bar for the whole page: a number
 * the owner cannot re-derive is a claim rather than a measurement, and a section caption is where the derivation
 * of a whole TABLE belongs — the per-row command would be the same string repeated down a column.
 *
 * @param filter the jq program that selects this section out of the verb's own report
 * @returns the caption line
 */
export function Recompute({ filter }: { filter: string }): ReactElement {
  return (
    <p className="sw-tile-note">
      Recompute: <code>slopweaver catalog health --json | jq &apos;{filter}&apos;</code>
    </p>
  );
}

/**
 * The length row's second cell — what would move if the owner steered on file length.
 *
 * `file-size-ratchet` adopted the owner's 300, so the bar and the cap are one number today and repeating it
 * reads as a stutter. The page still shows the gap whenever they diverge, because the distance between what
 * the owner asked for and what the tree refuses is the only part the owner can act on.
 *
 * @param health the live reading, carrying both numbers and both counts
 * @returns the cell
 */
function LengthGap({ health }: { health: HealthReading }): ReactElement {
  const debt = health.overOwnerBar - health.exemptOverBar - health.unrecordedOverBar;
  if (health.ownerBar === health.gateCap) {
    return (
      <>
        the same number <code>file-size-ratchet</code> refuses at. Of those over it, {String(debt)} are held as debt
        that has to come down, {String(health.exemptOverBar)} frozen at their own exempt ceiling
        <Unrecorded health={health} />
      </>
    );
  }
  return (
    <>
      {String(health.exemptOverBar)} of them frozen at their own exempt ceiling
      <Unrecorded health={health} />, and {String(health.overGateCap)} over the cap that actually refuses (
      {String(health.gateCap)})
    </>
  );
}

/**
 * The clause naming files over the bar that the committed floor holds no row for.
 *
 * Rendered only when there are some. In a tree whose CI is green there are none and the clause would be
 * noise; when there are, the page is looking at a working tree mid-change and saying so is the whole
 * difference between reporting and asserting — a marker is not proof of a recorded ceiling.
 *
 * @param health the reading
 * @returns the clause, or nothing
 */
function Unrecorded({ health }: { health: HealthReading }): ReactElement | null {
  if (health.unrecordedOverBar === 0) {
    return null;
  }
  return <>, {String(health.unrecordedOverBar)} on no baseline row at all</>;
}

/**
 * What one long file actually is, read off the committed floor rather than off its own text.
 *
 * `recorded` comes first because it is the stronger claim: a marker says a split would serve nobody, a ROW
 * says the gate is holding the file at a number. Without a row there is no ceiling to call it frozen at,
 * however the file is marked.
 *
 * @param one the longest-files row
 * @returns the cell's words
 */
export function LongFileState({ one }: { one: HealthReading["longest"][number] }): ReactElement {
  if (!one.recorded) {
    return <>no baseline row on the committed floor</>;
  }
  if (one.exempt) {
    return <>exempt: frozen ceiling, not a refactor</>;
  }
  return <>debt</>;
}

/** The headline counters: the whole tree in one line per dimension. */
export function Headline({ health }: { health: HealthReading }): ReactElement {
  return (
    <table className="sw-tile-table sw-atlas-table">
      <thead>
        <tr>
          <th>dimension</th>
          <th>where it stands</th>
          <th>the number that would move</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>size</td>
          <td>
            {String(health.modules)} modules across {String(health.trees)} trees
          </td>
          <td>{String(health.codeLines)} code lines, comments and blanks excluded</td>
        </tr>
        <tr>
          <td>tested</td>
          <td>{shareOf({ part: health.reachedByTest, whole: health.modules })} of modules are imported by some test</td>
          <td>
            {String(health.mirrored)} also have a mirrored unit file: a SECOND, weaker signal, reported beside it rather
            than blended in
          </td>
        </tr>
        <tr>
          <td>ruled</td>
          <td>
            {String(health.treesWithRule)} of {String(health.trees)} trees have an area rule
          </td>
          <td>
            {String(health.gatesRegistered)} lint gates registered, {String(health.gatesDeclared)} declared
          </td>
        </tr>
        <tr>
          <td>length</td>
          <td>
            {String(health.overOwnerBar)} files over your {String(health.ownerBar)}-line bar
          </td>
          <td>
            <LengthGap health={health} />
          </td>
        </tr>
        <tr>
          <td>sharing</td>
          <td>
            {String(health.libAliasImports)} imports reach <code>src/lib</code> by <code>#lib/…</code>
          </td>
          <td>
            {String(health.libRelativeImports)} still count <code>../</code>
          </td>
        </tr>
        <tr>
          <td>debt</td>
          <td>{String(health.debtEntries)} standing sites on the committed ratchets</td>
          <td>each list below carries its own previous total</td>
        </tr>
      </tbody>
    </table>
  );
}
