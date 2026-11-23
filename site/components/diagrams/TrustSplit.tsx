import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * The two inputs a routing judgement reads, and the one of them that may set the decision.
 *
 * A figure rather than a table because the claim is a BOUNDARY between two flows that reach the same
 * place and come out with different powers — which is exactly what a two-column table flattens into a
 * pair of descriptions. Drawn so that the arrow from quoted evidence visibly reaches the judgement and
 * visibly does not reach the box marked "respond, or not".
 *
 * @returns the figure, captioned
 */
export function TrustSplit(): ReactElement {
  return (
    <Figure
      arrow="sw-trust-arrow"
      viewBox="0 0 1060 434"
      label="Two disjoint inputs reach the routing judgement. The control plane (the owner's own addressing text plus structural facts) is the only input that may set whether to respond, at which tier, and which live reads to take. Quoted evidence, which is everyone else's thread and channel text plus every report a detective brings back, is labelled by author and source and may inform what the answer says, never what the judgement decides."
      caption={
        <>
          Slack text is untrusted and prompt wording is not a boundary, so the two inputs are{" "}
          <strong>two disjoint shapes in the type</strong> rather than one string. What that buys is real but bounded:
          it separates the inputs, and it cannot make a judgement honour the distinction while it reasons.
        </>
      }
    >
      <Kicker x={214} y={44} text="TWO INPUTS, DELIBERATELY DISJOINT" />
      <Kicker x={552} y={44} text="src/live/turn" />
      <Kicker x={890} y={44} text="WHAT COMES OUT" />

      <Solid
        x={24}
        y={68}
        w={340}
        h={104}
        fill={STAGE.out}
        title="controlPlane"
        detail="the owner's addressing text, plus facts"
        foot="the only input that may set the decision"
      />
      <Panel
        x={24}
        y={212}
        w={340}
        h={128}
        title="quotedEvidence"
        detail={["everyone else's thread and channel", "text, and every report a detective", "brings back"]}
        foot="labelled by author and by source"
      />

      <Arrow from={364} to={448} y={150} arrow="sw-trust-arrow" label="may set" />
      <Arrow from={364} to={448} y={230} arrow="sw-trust-arrow" label="informs" />

      <Solid
        x={452}
        y={126}
        w={200}
        h={120}
        fill={STAGE.mid}
        title="The judgement"
        detail="a visible session"
        foot="never a hidden model"
      />

      <Arrow from={652} to={740} y={140} arrow="sw-trust-arrow" label="sets" />
      <Arrow from={652} to={740} y={248} arrow="sw-trust-arrow" label="shapes" />

      <Solid
        x={748}
        y={96}
        w={288}
        h={88}
        fill={STAGE.in}
        title="respond, or not"
        detail="and at which tier"
        foot="plus the live reads it may take"
      />
      <Panel
        x={748}
        y={204}
        w={288}
        h={88}
        title="What the answer says"
        detail="its content, and its citations"
        foot="quoted evidence informs this half"
      />

      <text x={24} y={378} fontSize={11.5} fill="var(--sw-figure-muted)">
        The type enforces the split between the two INPUTS. It cannot force a judgement to honour the distinction
      </text>
      <text x={24} y={396} fontSize={11.5} fill="var(--sw-figure-muted)">
        while it reasons, so the routing cases carry author-labelled injection cases, and the guarantee the
      </text>
      <text x={24} y={414} fontSize={11.5} fill="var(--sw-figure-muted)">
        contract cannot make mechanically is the one the eval programme makes empirically instead.
      </text>
    </Figure>
  );
}
