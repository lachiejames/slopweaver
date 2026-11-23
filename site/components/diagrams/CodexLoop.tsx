import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

/**
 * The pairing loop: Codex plans, Claude implements, Codex reviews the diff — and what happens when the
 * Codex plan is capped.
 *
 * Drawn for rule 9's sharpest consequence, which is the part a session gets wrong: a cap does not stop the
 * work. A visible Claude session plans first and reviews after, and unplanned work rides a named
 * incompleteness rather than pretending the pairing floor was met.
 *
 * @returns the figure, captioned
 */
export function CodexLoop(): ReactElement {
  return (
    <Figure
      arrow="sw-codex-arrow"
      viewBox="0 0 1060 340"
      label="Codex plans, Claude implements every line, Codex reviews the diff. Both landing verbs require a conclusive plan the tree has since moved past, plus a current review of the diff. When Codex is capped, a visible Claude session plans with codex plan-fallback and reviews with codex review-fallback; work with no plan at all rides the codex-loop-incomplete marker. A cap proves neither half was met."
      caption={
        <>
          Claude and Codex <em>work better together than either alone.</em> Judgement picks how many passes and which
          property each attacks, never an area, and no longer <em>whether</em>.
        </>
      }
    >
      <Kicker x={530} y={36} text="THE PAIRING FLOOR: RULE 9" />

      <Solid
        x={24}
        y={64}
        w={236}
        h={96}
        fill={STAGE.in}
        title="Codex PLANS"
        detail="before the first edit"
        foot="codex plan"
      />
      <Arrow from={260} to={322} y={112} arrow="sw-codex-arrow" />
      <Solid
        x={330}
        y={64}
        w={236}
        h={96}
        fill={STAGE.mid}
        title="Claude IMPLEMENTS"
        detail="every line"
        foot="no hidden executor, any model"
      />
      <Arrow from={566} to={628} y={112} arrow="sw-codex-arrow" />
      <Solid
        x={636}
        y={64}
        w={236}
        h={96}
        fill={STAGE.out}
        title="Codex REVIEWS"
        detail="the diff, one property a pass"
        foot="codex review"
      />

      <Arrow from={872} to={934} y={112} arrow="sw-codex-arrow" />
      <Panel
        x={878}
        y={176}
        w={158}
        h={82}
        title="codex status --check"
        detail="the landing gate"
        foot={["a STALE plan +", "a CURRENT review"]}
      />
      <path
        d="M952 160 L952 176"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        markerEnd="url(#sw-codex-arrow)"
      />

      <Rail d="M142 160 L142 208" arrow="sw-codex-arrow" />
      <Rail d="M754 160 L754 208" arrow="sw-codex-arrow" />
      <Panel
        x={24}
        y={216}
        w={236}
        h={76}
        title="codex plan-fallback"
        detail="a VISIBLE Claude session plans"
        foot="when Codex is capped"
      />
      <Panel
        x={636}
        y={216}
        w={236}
        h={76}
        title="codex review-fallback"
        detail="a VISIBLE Claude session reviews"
        foot="when Codex is capped"
      />

      <Panel
        x={330}
        y={216}
        w={236}
        h={76}
        title="codex-loop-incomplete"
        detail="what UNPLANNED work rides"
        foot="named, never assumed met"
      />

      <text x="24" y="322" fontSize="11.5" fill="var(--sw-figure-muted)">
        A cap proves neither half was met; it is why the fallbacks exist, and why nothing stops.
      </text>
    </Figure>
  );
}
