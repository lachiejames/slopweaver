import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const SIDE_TABLES = [
  { x: 24, name: "content_slack", key: "channel_id · message_ts · thread_ts" },
  { x: 276, name: "content_github", key: "repo · number · review_state" },
  { x: 528, name: "content_linear", key: "team · identifier · state" },
  { x: 780, name: "content_notion", key: "page_id · parent · last_edited" },
] as const;

const LEDGERS = [
  { x: 24, name: "door_event", detail: "every outbound act" },
  { x: 224, name: "autonomy_event", detail: "acted without asking" },
  { x: 424, name: "grant_row", detail: "one row, one change" },
  { x: 624, name: "run · run_event", detail: "the orchestration journal" },
  { x: 824, name: "board_row", detail: "the one board" },
] as const;

/**
 * The store's shape: one content table with a `source` discriminator, four per-source side tables hung
 * off a composite key, and the ledgers that are not content at all.
 *
 * Drawn for the claim that makes the schema worth a page — a Slack row's channel is a real column with a
 * `NOT NULL`, not a key in a jsonb bag, so attaching a `content_slack` row to a GitHub content row is a
 * database refusal rather than a review note. The `(id, source)` unique constraint is what buys that, and
 * it is drawn as the thing the side tables point at.
 *
 * @returns the figure, captioned
 */
export function StoreSchema(): ReactElement {
  return (
    <Figure
      arrow="sw-schema-arrow"
      viewBox="0 0 1060 520"
      label="The content table carries source, source_id, kind, url, occurred_at, author, body, visibility and a stored generated tsvector column. Four per-source tables (content_slack, content_github, content_linear and content_notion) each hold that platform's own required columns and reference content by a composite foreign key on id and source, so a row cannot be attached to the wrong source. Five ledger tables sit beside it and hold acts rather than content."
      caption={
        <>
          Nineteen tables. The middle one is every record from every source; the four under it are what each platform
          actually gives you, as real columns. Retrieval is Postgres full text: <code>searchable</code> is a{" "}
          <strong>stored generated column</strong>, so it cannot drift from the text it summarises. pgvector, embeddings
          and re-ranking are banished.
        </>
      }
    >
      <Kicker x={530} y={32} text="ONE ROW SHAPE, ONE SOURCE DISCRIMINATOR" />

      <Solid
        x={276}
        y={52}
        w={508}
        h={118}
        fill={STAGE.mid}
        title="content"
        detail="source · source_id · kind · url · occurred_at"
        foot="author_id + author_native_id · body · visibility · metadata"
      />
      <rect x="292" y="126" width="476" height="30" rx="6" fill="#ffffff" opacity="0.16" />
      <text x="306" y="146" fontSize="11.5" fill="#ffffff">
        searchable: tsvector, GENERATED ALWAYS, gin-indexed
      </text>

      <rect
        x="292"
        y="176"
        width="476"
        height="26"
        rx="6"
        fill="var(--sw-figure-panel)"
        stroke="var(--sw-figure-line)"
      />
      <text x="530" y="194" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--sw-figure-ink)">
        unique (id, source): what every side table's composite key references
      </text>

      {SIDE_TABLES.map((table) => (
        <g key={table.name}>
          <Arrow from={table.x + 118} to={table.x + 118} y={236} arrow="sw-schema-arrow" />
          <Panel
            x={table.x}
            y={250}
            w={236}
            h={70}
            title={table.name}
            detail={table.key}
            foot="raw envelope · NOT NULL keys"
          />
        </g>
      ))}
      <path
        d="M142 236 L142 214 L918 214 L918 236 M394 236 L394 214 M646 236 L646 214"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />

      <Kicker x={530} y={366} text="NOT CONTENT: WHAT THE FLEET DID" />
      {LEDGERS.map((ledger) => (
        <Panel key={ledger.name} x={ledger.x} y={382} w={184} h={62} title={ledger.name} detail={ledger.detail} />
      ))}

      <text x={24} y={470} fontSize={11.5} fill="var(--sw-figure-muted)">
        Row-level security is declared per table. `content` is the one with a private lane, so it is the one
      </text>
      <text x={24} y={488} fontSize={11.5} fill="var(--sw-figure-muted)">
        whose bot predicate is not `true`: a private channel, a DM, the mailbox and the diary are denied to
      </text>
      <text x={24} y={506} fontSize={11.5} fill="var(--sw-figure-muted)">
        the Slack-facing role by the DATABASE, not by a filter every future caller has to remember.
      </text>
    </Figure>
  );
}
