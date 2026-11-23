import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * Bronze, silver, gold — what each tier is, what builds it, and the one that no model touches.
 *
 * Drawn for the fact a reader gets wrong most often: bronze and silver are DETERMINISTIC. `derive` is
 * pure code over what was ingested, so a silver directory can be rebuilt byte for byte; only gold is
 * composed by a model, and it is composed in a visible session rather than inside the CLI.
 *
 * @returns the figure, captioned
 */
export function CorpusTiers(): ReactElement {
  return (
    <Figure
      arrow="sw-tiers-arrow"
      viewBox="0 0 1060 340"
      label="Four provider sources are ingested by slopweaver refresh into bronze, the raw record set on disk. Then slopweaver derive builds silver (the people directory, the cross-reference graph and the opportunity list) by pure code with no model. Last, slopweaver distil builds gold markdown, and it is the only tier a model composes, in a visible session rather than inside the CLI."
      caption={
        <>
          Two of the three tiers are pure code. That is why a rebuild can be proved lossless: run{" "}
          <code>slopweaver derive</code> twice and the silver is identical. Gold is the only tier a model composes, and
          it is never needed to answer a question: <code>store read</code> reads bronze and silver.
        </>
      }
    >
      <Kicker x={112} y={34} text="PROVIDERS" />
      <Kicker x={530} y={34} text="ON THIS MACHINE" />
      <Kicker x={940} y={34} text="WHAT READS IT" />

      <Panel
        x={24}
        y={56}
        w={176}
        h={196}
        title="Slack"
        detail="GitHub · Linear · Notion"
        foot={["Gmail, diary and calls", "only when named"]}
      />

      <Arrow from={200} to={256} y={154} arrow="sw-tiers-arrow" label="refresh" />

      <Solid
        x={264}
        y={56}
        w={200}
        h={86}
        fill={STAGE.in}
        title="BRONZE"
        detail="the record set, on disk"
        foot="jsonl windows → compact.jsonl"
      />
      <Solid
        x={264}
        y={156}
        w={200}
        h={86}
        fill={STAGE.mid}
        title="SILVER"
        detail="directory · graph · opportunities"
        foot="derive: pure, zero models"
      />
      <Solid x={264} y={256} w={200} h={62} fill={STAGE.out} title="GOLD" detail="distilled markdown" />

      <Arrow from={464} to={520} y={99} arrow="sw-tiers-arrow" />
      <Arrow from={464} to={520} y={199} arrow="sw-tiers-arrow" />
      <Arrow from={464} to={520} y={287} arrow="sw-tiers-arrow" />

      <Panel
        x={528}
        y={56}
        w={280}
        h={86}
        title="Postgres full text"
        detail="to_tsvector, gin, trigram ladder"
        foot="no pgvector, no embeddings, no re-rank"
      />
      <Panel
        x={528}
        y={156}
        w={280}
        h={86}
        title="A resolved person"
        detail="four native ids to one human"
        foot="a bot is never a person"
      />
      <Panel
        x={528}
        y={256}
        w={280}
        h={62}
        title="Composed by a MODEL"
        detail="in a visible session, never in the CLI"
      />

      <Arrow from={808} to={860} y={154} arrow="sw-tiers-arrow" />
      <Solid
        x={868}
        y={110}
        w={168}
        h={92}
        fill={STAGE.mid}
        title="store read · store cite"
        detail="the answer, cited"
        foot="gold is not required"
      />
    </Figure>
  );
}
