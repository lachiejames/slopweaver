import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const RUNGS = [
  { y: 86, t: "to_tsvector, gin index", d: "the stemmed word appears", m: "~100 ms" },
  {
    y: 158,
    t: "trigram narrowing scan",
    d: "these characters appear: inside an email, a mention, a URL path",
    m: "< 1 s",
  },
  { y: 230, t: "the same term, no index", d: "body ilike '%nz%'", m: "seconds" },
] as const;

/**
 * Retrieval, and the measurement that settles why there is no vector store here.
 *
 * The figure exists to carry one number set rather than a claim: on a couple of million rows, the tsvector
 * answers in about 100 ms where an unindexed substring takes several seconds, and the trigram indexes exist for the questions a
 * stemmer cannot answer at all — a name inside an email address or a `<@U…>` mention.
 *
 * @returns the figure, captioned
 */
export function RetrievalLadder(): ReactElement {
  return (
    <Figure
      arrow="sw-retrieval-arrow"
      viewBox="0 0 1060 340"
      label="Retrieval is Postgres full text. Measured on a couple of million rows: the generated tsvector column answers in about 100 milliseconds, the trigram narrowing scan the substring ladder runs on answers in under a second, and the same substring with no index takes several seconds. pgvector, embeddings and re-ranking are banished."
      caption={
        <>
          MEASURED against <strong>a couple of million rows</strong>. Reproduce with{" "}
          <code>slopweaver store probe --term barten</code>. pgvector, embeddings and re-ranking are{" "}
          <strong>banished</strong>. Read that before proposing test machinery that assumes them.
        </>
      }
    >
      <Kicker x={530} y={34} text="ONE QUESTION, THREE WAYS TO ASK IT" />
      <Solid
        x={24}
        y={60}
        w={232}
        h={240}
        fill={STAGE.mid}
        title="A term"
        detail="from store read or store cite"
        foot="no embedding is computed"
      />
      {RUNGS.map((rung) => (
        <g key={rung.t}>
          <Arrow from={256} to={318} y={rung.y + 30} arrow="sw-retrieval-arrow" />
          <Panel x={326} y={rung.y} w={560} h={60} title={rung.t} detail={rung.d} />
          <rect x="902" y={rung.y} width="134" height="60" rx="9" fill={STAGE.out} />
          <text x="969" y={rung.y + 37} textAnchor="middle" fontSize="16" fontWeight="700" fill="#ffffff">
            {rung.m}
          </text>
        </g>
      ))}
      <text x="24" y="330" fontSize="11.5" fill="var(--sw-figure-muted)">
        `searchable` is a STORED generated column, so there is no rebuild step to skip and no second artefact that can
        go stale, which is the whole failure of the hand-built index it replaces.
      </text>
    </Figure>
  );
}
