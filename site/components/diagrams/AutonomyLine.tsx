import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * Graduated autonomy, drawn as the line it actually is: whose idea the work was.
 *
 * The criterion that a session gets wrong is not "how risky" — it is origin. The owner's own steer self-merges;
 * a fix the fleet went and found lands with a ledger row and no card; an ask that CHANGES the direction
 * the owner agreed is the phase rule instead, which is a page, the owner's reaction, then the act.
 *
 * @returns the figure, captioned
 */
export function AutonomyLine(): ReactElement {
  return (
    <Figure
      arrow="sw-autonomy-arrow"
      viewBox="0 0 1060 340"
      label="Graduated autonomy turns on whose idea the work was. Work the owner steered is acted on and merged unasked. A fix the fleet found itself lands with an autonomy ledger row and no card. A team-facing finding still needs the owner's own word. An ask that would change the direction they already agreed goes through the phase rule: a page, their reaction, then the act."
      caption={
        <>
          The criterion is <strong>whose idea it was</strong>, not how risky it looks. Obvious to a session that knows
          the owner → do it, and <strong>record it</strong> with <code>slopweaver autonomy record</code>. Unclear → card
          it. No tier-3 rail widens either way.
        </>
      }
    >
      <Kicker x={530} y={34} text="WHOSE IDEA WAS IT?" />
      <Solid x={380} y={56} w={300} h={54} fill={STAGE.mid} title="The work in front of you" />

      <Arrow from={200} to={200} y={140} arrow="sw-autonomy-arrow" />
      <Arrow from={530} to={530} y={140} arrow="sw-autonomy-arrow" />
      <Arrow from={860} to={860} y={140} arrow="sw-autonomy-arrow" />
      <path
        d="M200 116 L200 128 L860 128 L860 116 M530 128 L530 116 M530 110 L530 128"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />

      <Panel
        x={24}
        y={148}
        w={352}
        h={74}
        title="THE OWNER'S STEER"
        detail="the owner asked for this change"
        foot="act, and self-merge on green"
      />
      <Panel
        x={354}
        y={148}
        w={352}
        h={74}
        title="THE FLEET FOUND IT"
        detail="a bug nobody asked about"
        foot="land it, with a ledger row (no card)"
      />
      <Panel
        x={684}
        y={148}
        w={352}
        h={74}
        title="IT FACES THE TEAM"
        detail="a finding aimed at a colleague"
        foot="the owner's own word: a chair relay never is"
      />

      <Solid
        x={24}
        y={248}
        w={682}
        h={66}
        fill={STAGE.out}
        title="Recorded with `slopweaver autonomy record`"
        detail="never a shell redirect: the ledger is what the briefing renders from"
      />
      <Solid
        x={684}
        y={248}
        w={352}
        h={66}
        fill={STAGE.in}
        title="CHANGES the agreed direction?"
        detail="the phase rule: a page, the owner's reaction, then act"
      />
    </Figure>
  );
}
