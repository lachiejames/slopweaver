import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

/**
 * Why a human cannot be two rows, and why a platform id cannot belong to two people.
 *
 * The email is the key and each platform's id is a COLUMN on that one row, so both of those become database
 * refusals rather than review notes. Drawn for the half a reader skips: the null arms. A bot has no mailbox
 * to key on and never enters `person` at all — what it authored keeps the platform's own author id, so it is
 * still attributed, to the bot.
 *
 * @returns the figure, captioned
 */
export function IdentityKey(): ReactElement {
  return (
    <Figure
      arrow="sw-identity-arrow"
      viewBox="0 0 1060 380"
      label="People are keyed on the email address. The Google Workspace directory is the first authority and the member pull the second; a name-only match is recorded as a candidate and never applied. One person row carries the email as a unique not-null key plus one nullable, unique, shape-checked column per platform id. A content row's author_id is the human that its native id resolved to and is null for a bot or a stranger, while author_native_id is set whenever a record names an author at all, so a bot's post is still attributed, to the bot."
      caption={
        <>
          <em>The email address is the key; Slack, Linear and GitHub user ids are columns added to it</em>. One email is
          one person, so a human cannot be two rows; one platform id is one column on one row, so it cannot belong to
          two people.
        </>
      }
    >
      <Kicker x={154} y={34} text="IN ORDER OF AUTHORITY" />
      <Kicker x={492} y={34} text="ONE ROW PER HUMAN" />
      <Kicker x={868} y={34} text="WHAT A CONTENT ROW CARRIES" />

      <Panel
        x={24}
        y={56}
        w={260}
        h={80}
        title="Google Workspace"
        detail="directory.users.list"
        foot="a snapshot: absence is information"
      />
      <Panel
        x={24}
        y={152}
        w={260}
        h={80}
        title="The member pull"
        detail="corpus/members/<source>.jsonl"
        foot="a trusted address joins that person"
      />
      <Panel
        x={24}
        y={248}
        w={260}
        h={80}
        title="A name-only match"
        detail="person_link_candidate"
        foot="recorded, never applied"
      />

      <Arrow from={284} to={350} y={96} arrow="sw-identity-arrow" label="keys" />
      <Arrow from={284} to={350} y={192} arrow="sw-identity-arrow" label="joins" />
      <Rail d="M 284 288 L 350 288" arrow="sw-identity-arrow" />
      <text x="317" y="279" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
        proposes
      </text>

      <Solid
        x={358}
        y={64}
        w={268}
        h={96}
        fill={STAGE.mid}
        title="person"
        detail="email UNIQUE NOT NULL"
        foot="one human cannot be two rows"
      />
      <Panel
        x={358}
        y={176}
        w={268}
        h={152}
        title="…and one column per platform"
        detail={[
          "slack_user_id",
          "linear_user_id · linear_display_name",
          "github_id · github_login",
          "notion_user_id · google_id",
        ]}
        foot="each nullable, each UNIQUE, CHECKed"
      />

      <Arrow from={626} to={692} y={112} arrow="sw-identity-arrow" label="re-points" />
      <Panel
        x={700}
        y={64}
        w={336}
        h={96}
        title="content.author_id"
        detail="the human that native id resolved to"
        foot="null for a bot or a stranger"
      />
      <Rail d="M 868 160 L 868 190" arrow="sw-identity-arrow" />
      <Panel
        x={700}
        y={198}
        w={336}
        h={96}
        title="content.author_native_id"
        detail="what the platform said authored the row"
        foot="so a bot's post is still attributed, to the bot"
      />

      <text x="24" y="356" fontSize="11.5" fill="var(--sw-figure-muted)">
        MEASURED: ~2k person rows became ~1k; hundreds carry two or more platform ids; 0 are named by an
      </text>
      <text x="24" y="374" fontSize="11.5" fill="var(--sw-figure-muted)">
        id. Reproduce with `slopweaver store identity`: a second run over unchanged inputs writes nothing.
      </text>
    </Figure>
  );
}
