import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * The four things a composed answer has to get past, and what each one does instead of repairing it.
 *
 * The claim IS the ordering, which is the one thing a table cannot carry: a reviewer that ran after the
 * form had already been rendered would be reviewing a different artifact, and a door that ran before the
 * voice rules would journal a send the voice gate then refused. So it is drawn as four rungs in order,
 * each paired with the refusal it produces rather than the repair it does not make.
 *
 * @returns the figure, captioned
 */
export function AnswerGauntlet(): ReactElement {
  return (
    <Figure
      arrow="sw-gauntlet-arrow"
      viewBox="0 0 1060 500"
      label="A composed answer passes four gates in order, and each one refuses rather than repairing. An independent reviewer in a different session issues a verdict bound to a digest of the answer's bytes. The reviewer itself refuses nothing; it is the door that refuses to send an answer whose verdict is missing, stale, self-issued or bad. The outbound form is a strict typed schema, so an undeclared key is refused and the message names the nearest valid field. The voice rules run on authored prose before any network call and append a refused row to the door ledger. The admit door returns pass, warn or hold, and holds an act that claims to need approval while passing no approval gate."
      caption={
        <>
          Four gates, in this order, and not one of them repairs. A truncated message and a silently dropped field both
          read perfectly and say less than they claim: <strong>a refused send is visible and retryable</strong>, which
          is the whole argument for refusing rather than fixing.
        </>
      }
    >
      <Kicker x={224} y={44} text="THE GATE, IN ORDER" />
      <Kicker x={792} y={44} text="WHAT IT REFUSES, RATHER THAN REPAIRS" />

      <Solid
        x={24}
        y={68}
        w={400}
        h={88}
        fill={STAGE.in}
        title="1 · An independent reviewer"
        detail="a session that did not write it"
        foot="its verdict binds to the answer's digest"
      />
      <Arrow from={424} to={540} y={112} arrow="sw-gauntlet-arrow" label="issues" />
      <Panel
        x={548}
        y={68}
        w={488}
        h={88}
        title="A verdict, which the DOOR refuses if it is bad"
        detail="missing, stale, self-issued, or leaving a claim open"
        foot="edit the answer and the digest binding breaks"
      />

      <Solid
        x={24}
        y={176}
        w={400}
        h={88}
        fill={STAGE.mid}
        title="2 · The outbound form"
        detail="a typed schema, never a string"
        foot="strict: an undeclared key is refused"
      />
      <Arrow from={424} to={540} y={220} arrow="sw-gauntlet-arrow" label="refuses" />
      <Panel
        x={548}
        y={176}
        w={488}
        h={88}
        title="A key nobody declared, and a shape past the fold"
        detail="and the message names the nearest valid field"
        foot="a card that posts without its point is silent; a refusal is not"
      />

      <Solid
        x={24}
        y={284}
        w={400}
        h={88}
        fill={STAGE.mid}
        title="3 · The voice rules"
        detail="the owner's own per-example picks"
        foot="every outbound surface, not just as-me"
      />
      <Arrow from={424} to={540} y={328} arrow="sw-gauntlet-arrow" label="refuses" />
      <Panel
        x={548}
        y={284}
        w={488}
        h={88}
        title="Prose breaking a character, word or phrase rule"
        detail="before any network call, naming its own override"
        foot="and it appends a refused row to the door ledger"
      />

      <Solid
        x={24}
        y={392}
        w={400}
        h={88}
        fill={STAGE.out}
        title="4 · The admit door"
        detail="one gated pathway, journalled"
        foot="pass, warn or hold, and a row either way"
      />
      <Arrow from={424} to={540} y={436} arrow="sw-gauntlet-arrow" label="holds" />
      <Panel
        x={548}
        y={392}
        w={488}
        h={88}
        title="An act claiming approval it never actually gets"
        detail="requiresApproval, passing no approval gate, is a hold"
        foot="the effect never runs, and the attempt is recorded"
      />
    </Figure>
  );
}
