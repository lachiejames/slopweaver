import type { ReactElement } from "react";

import { Figure, Kicker, Panel, Solid } from "./figure";

const GRADES = [
  {
    y: 64,
    fill: "var(--sw-stage-out)",
    grade: "GOLD",
    what: "a witness taken against the head CI tested",
    needs: "proof-commit: CI compares to the head · proof-patch-id: a pure rebase keeps",
  },
  {
    y: 152,
    fill: "var(--sw-stage-mid)",
    grade: "SILVER",
    what: "the mechanism proved, not at that head",
    needs: "mergeable when gold genuinely was not feasible, and gold stays OWED",
  },
  {
    y: 240,
    fill: "var(--sw-stage-in)",
    grade: "BRONZE",
    what: "the change argued, not exercised",
    needs: "same rule: mergeable, and gold stays OWED",
  },
] as const;

/**
 * The three proof grades, what each actually asserts, and the two fields only gold carries.
 *
 * Drawn because the grade is routinely read as a quality score, which it is not — it is a statement about
 * WHEN the witness was taken relative to the commit CI tested. That is why gold needs a `proof-commit:`
 * and a `proof-patch-id:`: one binds the witness to a head, the other survives a pure rebase.
 *
 * @returns the figure, captioned
 */
export function ProofLadder(): ReactElement {
  return (
    <Figure
      arrow="sw-proof-arrow"
      viewBox="0 0 1060 380"
      label="Three proof grades. Gold carries a proof-commit that CI compares to the head and a proof-patch-id that a pure rebase preserves. Silver proved the mechanism but not at that head. Bronze argued the change without exercising it. Silver and bronze may be merged when gold genuinely was not feasible at the time, and gold still stays owed."
      caption={
        <>
          The grade says <strong>when</strong> the witness was taken, not how good the change is. “Feasible” is a
          judgement; do not invent a heuristic for it. Silver and bronze land when gold genuinely was not feasible then,
          and <strong>gold stays owed</strong>.
        </>
      }
    >
      <Kicker x={530} y={34} text="WHAT A GRADE ASSERTS" />
      {GRADES.map((row) => (
        <g key={row.grade}>
          <Solid x={24} y={row.y} w={188} h={72} fill={row.fill} title={row.grade} />
          <Panel x={232} y={row.y} w={804} h={72} title={row.what} detail={row.needs} />
        </g>
      ))}
      <text x="24" y="346" fontSize="11.5" fill="var(--sw-figure-muted)">
        Take the witness yourself. A gold witness is self-serviced, never carded; if a human half is genuinely needed,
        post under the owner's identity to the bot, never a colleague, and settle it rather than asking for a
        screenshot.
      </text>
    </Figure>
  );
}
