import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * What an atlas is, and the distinction that makes a zero in one trustworthy.
 *
 * An atlas holds what a PLATFORM is — its operations, its pages, its settings — and never the content the
 * corpus holds. The figure is drawn for its claim boundary: a zero means "this surface was walked
 * and held none", and a not-configured means "nothing was ever asked". Conflating the two is how an atlas
 * reports confidently about a platform it has never reached.
 *
 * @returns the figure, captioned
 */
export function AtlasShape(): ReactElement {
  return (
    <Figure
      arrow="sw-atlas-arrow"
      viewBox="0 0 1060 340"
      label="An atlas is built from up to three surfaces: a published specification compiled offline with no credential, a live API surface read under a read-only grant, and a browser surface walked and photographed in the owner's own Chrome. Every stored cell carries which surface answered it, so a zero that was measured is distinguishable from a not-configured that was never asked."
      caption={
        <>
          An atlas holds <strong>what a platform is</strong>, never what your org said: that is the corpus's. The
          distinction that makes it usable: a <strong>measured zero</strong> and a <strong>never-asked</strong> are
          different cells, and the atlas says which one you have.
        </>
      }
    >
      <Kicker x={176} y={36} text="THREE SURFACES" />
      <Panel
        x={24}
        y={56}
        w={304}
        h={66}
        title="The published specification"
        detail="compiled offline"
        foot="no credential, no network"
      />
      <Panel
        x={24}
        y={134}
        w={304}
        h={66}
        title="The live API"
        detail="read-only grant, bounded"
        foot="often unfilled, and it says so"
      />
      <Panel
        x={24}
        y={212}
        w={304}
        h={66}
        title="The web client"
        detail="walked in the owner's Chrome"
        foot="every page photographed"
      />

      <Arrow from={328} to={392} y={89} arrow="sw-atlas-arrow" />
      <Arrow from={328} to={392} y={167} arrow="sw-atlas-arrow" />
      <Arrow from={328} to={392} y={245} arrow="sw-atlas-arrow" />

      <Solid
        x={400}
        y={110}
        w={240}
        h={114}
        fill={STAGE.mid}
        title="One generation"
        detail="every cell names its surface"
        foot="atlas <platform> coverage"
      />

      <Arrow from={640} to={704} y={167} arrow="sw-atlas-arrow" />
      <Panel x={712} y={76} w={324} h={66} title="MEASURED ZERO" detail="the surface was walked and held none" />
      <Panel
        x={712}
        y={156}
        w={324}
        h={66}
        title="NOT CONFIGURED"
        detail="nothing was ever asked, and it names what is missing"
      />
      <Panel x={712} y={236} w={324} h={66} title="WITHHELD" detail="reachable, and deliberately never stored" />

      <text x="24" y="320" fontSize="11.5" fill="var(--sw-figure-muted)">
        {"`atlas <platform> report` is where the surfaces disagree: the finding an atlas exists to produce."}
      </text>
    </Figure>
  );
}
