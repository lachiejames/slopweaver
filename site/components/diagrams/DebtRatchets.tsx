import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const LISTS = [
  { x: 24, t: "file-size-baseline", d: "files over 560 code lines" },
  { x: 282, t: "internal-exports-baseline", d: "exports nothing outside names" },
  { x: 540, t: "no-silent-fallback-baseline", d: "?? and ||= sites left" },
  { x: 798, t: "error-shape-threshold", d: "directories past four shapes" },
] as const;

/**
 * Known technical debt, and the mechanism that makes it shrink rather than accumulate.
 *
 * The property worth a figure is the one that surprises people: a debt list fails **just as loudly when an
 * entry stops firing** as when a new one appears. A grandfathered offender that has been fixed and left
 * on the list is a lie about the state of the tree, so the gate reports it.
 *
 * @returns the figure, captioned
 */
export function DebtRatchets(): ReactElement {
  return (
    <Figure
      arrow="sw-debt-arrow"
      viewBox="0 0 1060 320"
      label="Known debt lives in baseline files under .baselines. A new offender fails the gate. An entry that has been fixed and left on the list also fails it, because a grandfathered offender that no longer exists is a false statement about the tree. The lists only shrink, and a rebaseline command is the only way to move one."
      caption={
        <>
          Debt is a <strong>list that only shrinks</strong>, in <code>.baselines/</code>. It fails when an entry
          <strong> stops</strong> firing too: a grandfathered offender that has since been fixed is a false statement
          about the tree, so the gate reports it rather than quietly passing.
        </>
      }
    >
      <Kicker x={530} y={34} text="FOUR STANDING DEBT LISTS" />
      {LISTS.map((list) => (
        <Panel key={list.t} x={list.x} y={52} w={238} h={72} title={list.t} detail={list.d} />
      ))}

      <Arrow from={286} to={286} y={162} arrow="sw-debt-arrow" />
      <Arrow from={774} to={774} y={162} arrow="sw-debt-arrow" />
      <path d="M286 124 L286 150 L774 150 L774 124" fill="none" stroke="currentColor" strokeWidth="1.4" />

      <Solid
        x={24}
        y={170}
        w={506}
        h={82}
        fill={STAGE.in}
        title="A NEW offender"
        detail="not on the list"
        foot="the gate refuses: fix it, or split along a real seam"
      />
      <Solid
        x={540}
        y={170}
        w={496}
        h={82}
        fill={STAGE.out}
        title="An entry that STOPPED firing"
        detail="fixed, and left on the list"
        foot="the gate refuses too: `yarn devlint:*-rebaseline` shrinks it"
      />

      <text x="24" y="292" fontSize="11.5" fill="var(--sw-figure-muted)">
        Anchor evidence in canon to a COMMIT, never to a live count: a number that goes to zero the moment the rule's
        own work lands reads as a stale rule to the next person who greps for it.
      </text>
    </Figure>
  );
}
