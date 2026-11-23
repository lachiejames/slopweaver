import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/** The refusal hue, on the one strip that says what belongs in neither register. */
const NEITHER = "#9f1239";

/**
 * The two registers, and the different things they hold.
 *
 * Confusing them is how a lesson learned the hard way ends up somewhere nothing will read it again. The
 * knowledge register holds what an INVESTIGATION found out; auto-memory holds what a SESSION should know
 * before it starts. The strip along the bottom is the bar both share, and it is the one people get wrong:
 * anything the repository already records belongs in neither.
 *
 * @returns the figure, captioned
 */
export function TwoRegisters(): ReactElement {
  return (
    <Figure
      arrow="sw-registers-arrow"
      viewBox="0 0 1060 360"
      label="The fleet writes to two different registers. The knowledge register holds one row per lesson with domain as a field, each carrying its verdict, what was measured and the command that settles it again, and is read back by facet with knowledge recall. Auto-memory holds one file per fact with a one-line index loaded at session start, and its bar is that a memory has to change behaviour; memory hygiene proposes prunes and never makes one. Anything the repository already records belongs in neither."
      caption={
        <>
          <strong>No run ends without saying whether it learned anything.</strong> That is the closing question on every
          orchestration run, and it is why the register fills from ordinary work rather than from somebody remembering
          to write a postmortem.
        </>
      }
    >
      <Kicker x={530} y={34} text="TWO REGISTERS, AND THEY HOLD DIFFERENT THINGS" />

      <Solid
        x={24}
        y={100}
        w={150}
        h={160}
        fill={STAGE.in}
        title="The fleet"
        detail="every run"
        foot="two places to write"
      />

      <Arrow from={174} to={288} y={132} arrow="sw-registers-arrow" label="records a lesson" />
      <Panel
        x={296}
        y={88}
        w={380}
        h={88}
        title="The knowledge register"
        detail="one row per lesson, domain as a field"
        foot="verdict · what was measured · how to settle it"
      />
      <Arrow from={676} to={740} y={132} arrow="sw-registers-arrow" />
      <Solid
        x={748}
        y={88}
        w={288}
        h={88}
        fill={STAGE.mid}
        title="knowledge recall"
        detail="by facet, across domains"
        foot="have we hit this before?"
      />

      <Arrow from={174} to={288} y={228} arrow="sw-registers-arrow" label="carries forward" />
      <Panel
        x={296}
        y={200}
        w={380}
        h={88}
        title="Auto-memory"
        detail="one file per fact, a one-line index"
        foot="the bar: it has to CHANGE behaviour"
      />
      <Arrow from={676} to={740} y={244} arrow="sw-registers-arrow" />
      <Solid
        x={748}
        y={200}
        w={288}
        h={88}
        fill={STAGE.out}
        title="memory hygiene"
        detail="PROPOSES prunes"
        foot="and never makes one"
      />

      <rect x="296" y="304" width="740" height="44" rx="10" fill={NEITHER} />
      <text x="666" y="331" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">
        Neither holds what the repository already records: code structure, past fixes, git history, canon
      </text>
    </Figure>
  );
}
