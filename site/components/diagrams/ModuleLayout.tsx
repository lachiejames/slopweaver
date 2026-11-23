import type { ReactElement } from "react";

import { Figure, Kicker, Panel, Rail } from "./figure";

const BANDS = [
  {
    y: 58,
    kicker: "THE SURFACE",
    boxes: [
      { x: 24, t: "src/cli", d: "one file per verb" },
      { x: 282, t: "skills/", d: "one SKILL.md per verb" },
      { x: 540, t: "src/live", d: "the listener" },
      { x: 798, t: "site/", d: "this docs site" },
    ],
  },
  {
    y: 154,
    kicker: "THE ACT",
    boxes: [
      { x: 24, t: "src/admit", d: "the one door" },
      { x: 282, t: "src/outbound", d: "typed forms, shape-capped" },
      { x: 540, t: "src/handover", d: "the board and the journal" },
      { x: 798, t: "src/claude · src/cmux", d: "visible sessions only" },
    ],
  },
  {
    y: 250,
    kicker: "WHAT IT STANDS ON",
    boxes: [
      { x: 24, t: "src/corpus", d: "bronze · silver · gold" },
      { x: 282, t: "src/store", d: "Postgres tables, RLS declared" },
      { x: 540, t: "src/atlas", d: "72 platforms" },
      { x: 798, t: "src/lib", d: "Result, safe boundaries, dates" },
    ],
  },
] as const;

/**
 * The module layout, arranged by what each tree is ALLOWED to do rather than alphabetically.
 *
 * Drawn this way because the alphabetical listing `ls src` gives you hides the only structure that
 * matters here: the bands are a dependency direction. The act band reaches down into the foundation band
 * and never the other way, which is why a corpus module cannot post to Slack.
 *
 * @returns the figure, captioned
 */
export function ModuleLayout(): ReactElement {
  return (
    <Figure
      arrow="sw-modules-arrow"
      viewBox="0 0 1060 380"
      label="Three bands. The surface band holds the CLI, the skills, the listener and this site. The act band holds the admit door, the outbound forms, the handover board and the session launchers. The foundation band holds the corpus, the store, the atlases and the shared library. Bands depend downwards only."
      caption={
        <>
          Arranged by what each tree may do, not alphabetically. Dependencies point <strong>down</strong>: a corpus
          module cannot post to Slack, because the door is a band above it. Enumerate the real list with{" "}
          <code>ls src</code> and <code>slopweaver catalog</code>; counts here go stale, the shape does not.
        </>
      }
    >
      {BANDS.map((band) => (
        <g key={band.kicker}>
          <Kicker x={24} y={band.y - 10} text={band.kicker} anchor="start" />
          {band.boxes.map((box) => (
            <Panel key={box.t} x={box.x} y={band.y} w={238} h={64} title={box.t} detail={box.d} />
          ))}
        </g>
      ))}
      <Rail d="M1046 78 L1046 296" arrow="sw-modules-arrow" />
      <text
        x="1040"
        y="192"
        textAnchor="middle"
        fontSize="10.5"
        fill="var(--sw-figure-muted)"
        transform="rotate(-90 1040 192)"
      >
        DEPENDS ON
      </text>
      <text x="24" y="348" fontSize="11.5" fill="var(--sw-figure-muted)">
        A `paths:`-scoped area rule loads only for a session inside its tree: `src/admit`, `src/atlas`, `src/cli`,
        `src/corpus`, `src/handover`, `src/live`, `src/outbound`, and `src/devLint`.
      </text>
    </Figure>
  );
}
