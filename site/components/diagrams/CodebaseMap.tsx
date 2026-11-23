import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/** The six named subsystems, two rows of three. Named, never counted — the table below carries the totals. */
const SUBSYSTEMS = [
  { x: 264, y: 52, t: "src/live", d: "the listener" },
  { x: 440, y: 52, t: "src/outbound", d: "closed forms" },
  { x: 616, y: 52, t: "src/admit", d: "the one door" },
  { x: 264, y: 114, t: "src/corpus", d: "the corpus" },
  { x: 440, y: 114, t: "src/store", d: "the registers" },
  { x: 616, y: 114, t: "src/handover", d: "the board" },
] as const;

/**
 * How the trees import each other, and the one edge that runs the wrong way.
 *
 * Drawn from what `slopweaver catalog trees` derives rather than from anyone's mental model, and drawn as a
 * LEFT-TO-RIGHT flow rather than as bands, because the shape the measurement actually shows is a hub and a
 * floor: `src/cli` imports from nearly every tree and almost nothing imports it back, `src/lib` is imported
 * by nearly every tree and imports exactly one.
 *
 * That last number is why this figure has a second claim. `src/lib/sameDirectory.ts` reaches up into
 * `src/worktree/location.ts`, which imports `src/lib` straight back — a cycle between the shared floor and a
 * subsystem standing on it. Nobody wrote that down; the atlas found it the first time it ran, which is the
 * argument for the whole verb in one edge.
 *
 * No counts are drawn here on purpose. A hand-authored figure cannot be re-derived, so it carries the shape
 * and the live table underneath carries every number.
 *
 * @returns the figure, captioned
 */
export function CodebaseMap(): ReactElement {
  return (
    <Figure
      arrow="sw-atlas-arrow"
      viewBox="0 0 1060 252"
      label="Imports flow left to right. src/cli is the tree every verb is entered through and it imports from nearly every other tree. In the middle sit the subsystems: the listener, the outbound forms, the door, the corpus, the store and the board. On the right is src/lib, the shared floor nearly every tree imports. One edge runs the other way: src/lib reaches up into src/worktree, which imports src/lib back."
      caption={
        <>
          A hub and a floor. <code>src/cli</code> imports nearly every tree and is imported by few; <code>src/lib</code>{" "}
          is imported by nearly every tree and imports one. That one is the point: the atlas found a cycle between the
          shared floor and a subsystem standing on it, which nothing had written down.{" "}
          <code>src/lib/sameDirectory.ts</code> imports <code>src/worktree/location.ts</code>, which imports{" "}
          <code>src/lib</code> back. Re-derive the whole figure's shape with <code>slopweaver catalog trees</code>.
        </>
      }
    >
      <Kicker x={119} y={40} text="ENTERED THROUGH" />
      <Kicker x={524} y={40} text="THE SUBSYSTEMS" />
      <Kicker x={934} y={40} text="THE FLOOR" />

      <Solid
        x={24}
        y={52}
        w={190}
        h={116}
        fill={STAGE.in}
        title="src/cli"
        detail="one file per verb"
        foot="the only tree you type"
      />
      <Arrow from={218} to={260} y={110} arrow="sw-atlas-arrow" label="imports" />

      {SUBSYSTEMS.map((box) => (
        <Panel key={box.t} x={box.x} y={box.y} w={168} h={54} title={box.t} detail={box.d} />
      ))}

      <Arrow from={790} to={828} y={110} arrow="sw-atlas-arrow" label="imports" />
      <Solid
        x={832}
        y={52}
        w={204}
        h={116}
        fill={STAGE.out}
        title="src/lib"
        detail="Result · dates · safe JSON"
        foot="reached as #lib/…"
      />

      <Panel x={440} y={186} w={168} h={50} title="src/worktree" detail="node_modules truth" />
      <path
        d="M934 168 L934 211 L612 211"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        markerEnd="url(#sw-atlas-arrow)"
      />
      <text x={930} y={202} textAnchor="end" fontSize="11.5" fill="var(--sw-figure-muted)">
        one edge points back
      </text>
    </Figure>
  );
}
