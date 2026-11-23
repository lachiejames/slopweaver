import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

/**
 * The door's three verdicts, and the band underneath that records all three of them.
 *
 * The ledger is the half a table loses. Three verdicts side by side read as a policy; the claim worth
 * drawing is that `pass` lands in the same file as `hold`, because an audit trail that logs only the
 * exceptional case cannot tell you that nothing exceptional happened.
 *
 * @returns the figure, captioned
 */
export function AdmitVerdict(): ReactElement {
  return (
    <Figure
      arrow="sw-admit-arrow"
      viewBox="0 0 1060 448"
      label="A side-effecting act is routed through the admit door, which returns one of three verdicts. A pass runs the effect. A warn pauses it and returns a structured finding the caller can answer and re-issue past, waivable per act by a door override token or by a journalled grant. A hold refuses the irreversible-harm class, and that per-act token does not waive it, so the effect never runs. All three verdicts are written to the same door ledger, not only the refusals."
      caption={
        <>
          Three verdicts, and <strong>one ledger that records all three</strong>. Measured, the file held 199,954 rows
          and every one was a pass, a warn or a hold, which is exactly how a reader can tell that a refusal before the
          door left no trace at all, and why a pre-door refusal now writes its own row.
        </>
      }
    >
      <Kicker x={142} y={44} text="AN ACT" />
      <Kicker x={755} y={44} text="THE VERDICT IT COMES BACK WITH" />

      <Solid
        x={24}
        y={140}
        w={236}
        h={96}
        fill={STAGE.mid}
        title="A side effect"
        detail="gmail send · slack post"
        foot="routed through src/admit"
      />
      <Arrow from={260} to={344} y={188} arrow="sw-admit-arrow" label="is decided" />
      <path d="M352 110 L352 294" fill="none" stroke="currentColor" strokeWidth="1.6" />

      <Arrow from={352} to={466} y={110} arrow="sw-admit-arrow" label="runs" />
      <Solid
        x={474}
        y={72}
        w={562}
        h={76}
        fill={STAGE.out}
        title="pass"
        detail="the effect runs"
        foot="and a row says that it ran"
      />

      <Arrow from={352} to={466} y={202} arrow="sw-admit-arrow" label="pauses" />
      <Panel
        x={474}
        y={164}
        w={562}
        h={76}
        title="warn"
        detail="a structured finding the caller can answer and re-issue past"
        foot="waivable per act by a door token, or by a journalled grant"
      />

      <Arrow from={352} to={466} y={294} arrow="sw-admit-arrow" label="refuses" />
      <Panel
        x={474}
        y={256}
        w={562}
        h={76}
        title="hold"
        detail="the irreversible-harm class, and the one rule the door owns"
        foot="that per-act token does not waive it; the effect never runs"
      />

      <Rail d="M756 332 L756 352" arrow="sw-admit-arrow" />
      <Panel
        x={24}
        y={356}
        w={1012}
        h={76}
        title="One ledger, carrying all three verdicts and not only the refusals"
        detail="an audit trail that logs the exceptional case alone cannot tell you nothing exceptional happened"
        foot="read it back with slopweaver dev door, and its refusals half with dev door --refusals"
      />
      <text x={768} y={348} fontSize={11} fill="var(--sw-figure-muted)">
        every verdict, a pass included
      </text>
    </Figure>
  );
}
