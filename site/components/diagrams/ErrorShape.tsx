import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * How a failure is shaped, and the one threshold that turns a judgement into a gate.
 *
 * Drawn for the decision a session actually has to make: when to stop returning a list of strings and
 * declare a domain union. Below four distinct authored shapes in a directory it is a judgement and
 * restraint is correct; past four it is `error-shape-threshold`, and no longer yours to weigh.
 *
 * @returns the figure, captioned
 */
export function ErrorShape(): ReactElement {
  return (
    <Figure
      arrow="sw-errors-arrow"
      viewBox="0 0 1060 340"
      label="Two layers. Every external call goes through a safe wrapper that turns a throw into one shared typed IngestError. Every other fallible area either stays on the default Result with a list of strings, or declares its own domain discriminated union with a factory. The choice is a judgement below four distinct authored error shapes in a directory and a gate past it. A policy refusal is neither; it is an escape hatch with four fixed lines."
      caption={
        <>
          Real neverthrow <code>Result</code>, never a hand-rolled one: the ban is a gate whose criterion is a union
          with an <code>ok: true</code> member, and it measured <strong>110</strong> on the commit that removed them.
          State the criterion when you quote this, never a count.
        </>
      }
    >
      <Kicker x={176} y={36} text="THE INFRA BOUNDARY" />
      <Solid
        x={24}
        y={56}
        w={304}
        h={88}
        fill={STAGE.in}
        title="safeFs · safeCodex · safeProviderCall"
        detail="every external throw, typed once"
        foot="IngestError: essentially never touched"
      />

      <Kicker x={176} y={182} text="EVERY OTHER FALLIBLE AREA" />
      <Panel
        x={24}
        y={200}
        w={304}
        h={60}
        title="Result<T>, E = readonly string[]"
        detail="one or two messages nobody branches on"
      />
      <Arrow from={328} to={392} y={230} arrow="sw-errors-arrow" />
      <Panel
        x={400}
        y={200}
        w={304}
        h={60}
        title="Past FOUR distinct shapes"
        detail="in one directory, counted by the gate"
      />
      <Arrow from={704} to={768} y={230} arrow="sw-errors-arrow" />
      <Solid
        x={776}
        y={190}
        w={260}
        h={80}
        fill={STAGE.mid}
        title="A domain union"
        detail="<Domain>Error + its factory"
        foot="no shared base across domains, ever"
      />

      <Arrow from={328} to={392} y={100} arrow="sw-errors-arrow" label="mapErr at the boundary" />
      <Panel
        x={400}
        y={56}
        w={636}
        h={88}
        title="A POLICY refusal is not a domain error at all"
        detail="a gate saying no to something that would otherwise have worked"
        foot="four lines: what caught it · legitimate exceptions · the named hatch · use judgement"
      />

      <text x={24} y={300} fontSize={11.5} fill="var(--sw-figure-muted)">
        A directory whose whole point is a variable-length list of same-shaped problems (a Zod pass, a coherence
      </text>
      <text x={24} y={318} fontSize={11.5} fill="var(--sw-figure-muted)">
        check) stays a list. One discriminated error there loses the multiplicity, which IS the behaviour.
      </text>
    </Figure>
  );
}
