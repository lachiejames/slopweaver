import { describe, expect, it } from "vitest";

import { readBoard } from "../../../components/live/read";
import { type BoardRowAction, type BoardRowDestination } from "../../../components/live/readAction";
import { boardRowPlacement } from "../../../lib/registerPlacement";
import { findingLabel } from "../../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, acmeBy, BARE, BOARD_ROW, SLOPWEAVER_PR } from "./fixtures";

/** A Slack draft the row's action would post — the destination list is what places it. */
const SLACK_ACTION: BoardRowAction = {
  actor: "me",
  body: "the vanta groups never got created",
  destinations: [
    { channel: "C0SYN000001", kind: "channel", label: "#delivery", tradeoff: "the team sees it", url: undefined },
  ],
  followUps: [],
  mentions: [],
};

describe("asks — a board row", () => {
  it("places the ISO ask in team by its pull requests, and never reads its checkout", () => {
    expect(boardRowPlacement({ placer: ACME_PLACER, row: { ...BARE, prUrls: [ACME_ADMIN_PR] } })).toEqual(
      acmeBy({ source: "repository", value: "acme/acme-admin" }),
    );
  });

  it("places a row by its stated workspace:", () => {
    expect(boardRowPlacement({ placer: ACME_PLACER, row: { ...BARE, workspace: "self" } })).toEqual({
      by: [{ source: "stated", value: "self", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
  });

  it("places a card about a company repository in team by its statement, naming no pull request", () => {
    expect(boardRowPlacement({ placer: ACME_PLACER, row: { ...BARE, workspace: "team" } })).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
  });

  it("places a card asking to message a colleague in team, over the fleet's own pull requests behind it", () => {
    const placement = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, prUrls: [SLOPWEAVER_PR], workspace: "team" },
    });
    expect(placement).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      overruled: [{ source: "repository", value: "octo-self/slopweaver", workspace: "self" }],
      workspace: "team",
    });
    expect(findingLabel({ placement })).toEqual({
      label: "stated over a conflict",
      title: "stated team, overruling: repository octo-self/slopweaver → self",
    });
  });

  it("places a row whose action posts to Slack in team", () => {
    expect(
      boardRowPlacement({ placer: ACME_PLACER, row: { ...BARE, action: { action: SLACK_ACTION, kind: "action" } } }),
    ).toEqual(acmeBy({ source: "slack-workspace", value: "Slack destination #delivery (C0SYN000001)" }));
  });

  it("leaves a row whose action would not read a finding, though its pull request names Slopweaver", () => {
    const why = "one of the action's destinations does not name where it would send";
    expect(
      boardRowPlacement({
        placer: ACME_PLACER,
        row: { ...BARE, action: { kind: "invalid", why }, prUrls: [SLOPWEAVER_PR] },
      }),
    ).toStrictEqual({
      kind: "unplaced",
      // The parse's reason is the warning beside the finding, never inside its hover's own words (steer 7).
      warning: { lead: "Its action would not read", subject: "this row's action", why },
      why: "its action would not read, so a Slack destination may be hidden (NOT MEASURED)",
    });
  });

  it("names each of two threads in one channel apart when a stated workspace overrules them", () => {
    const thread = ({ threadTs }: { threadTs: string }): BoardRowDestination => ({
      channel: "C123",
      kind: "thread",
      label: "#ops",
      permalink: undefined,
      threadTs,
      tradeoff: "only the thread sees it",
    });
    const action = {
      ...SLACK_ACTION,
      destinations: [thread({ threadTs: "1720000000.000100" }), thread({ threadTs: "1720000000.000200" })],
    };
    const placement = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, action: { action, kind: "action" }, workspace: "self" },
    });
    expect(findingLabel({ placement })!.title).toBe(
      "stated self, overruling: slack-workspace Slack destination #ops (C123 thread 1720000000.000100) → team; " +
        "slack-workspace Slack destination #ops (C123 thread 1720000000.000200) → team",
    );
  });

  it("weighs a destination's own link, so a channel url naming a repository conflicts with its Slack send", () => {
    const channel: BoardRowDestination = {
      channel: "C123",
      kind: "channel",
      label: "#team",
      tradeoff: "the whole team sees it",
      url: "https://github.com/octo-self/slopweaver",
    };
    const placement = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, action: { action: { ...SLACK_ACTION, destinations: [channel] }, kind: "action" } },
    });
    expect(placement).toEqual({
      evidence: [
        { source: "slack-workspace", value: "Slack destination #team (C123)", workspace: "team" },
        { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
      ],
      kind: "conflict",
    });
    const permalinked = boardRowPlacement({
      placer: ACME_PLACER,
      row: {
        ...BARE,
        action: {
          action: {
            ...SLACK_ACTION,
            destinations: [
              {
                channel: "C123",
                kind: "thread",
                label: "#ops",
                permalink: "https://acme.slack.com/archives/C123/p1720000000000100",
                threadTs: "1720000000.000100",
                tradeoff: "only the thread sees it",
              },
            ],
          },
          kind: "action",
        },
      },
    });
    expect(permalinked).toMatchObject({ kind: "placed", workspace: "team" });
  });

  it("names the Slack destination a stated workspace overrules", () => {
    const placement = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, action: { action: SLACK_ACTION, kind: "action" }, workspace: "self" },
    });
    expect(findingLabel({ placement })).toEqual({
      label: "stated over a conflict",
      title: "stated self, overruling: slack-workspace Slack destination #delivery (C0SYN000001) → team",
    });
  });

  it("reads no workspace out of the Slack thread its summary quotes — where it was discussed, not whose it is", () => {
    const quoted = readBoard({
      rows: [
        {
          ...BOARD_ROW,
          prUrls: [SLOPWEAVER_PR],
          slug: "as-me-voice-rule",
          summaryAnchor: "https://acme.slack.com/archives/C1/p123",
        },
      ],
      unresolved: 0,
    })!;
    expect(boardRowPlacement({ placer: ACME_PLACER, row: quoted.rows[0] })).toEqual({
      by: [{ source: "repository", value: "octo-self/slopweaver", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
  });

  it("leaves a row with no evidence unplaced, rather than defaulting it to self", () => {
    expect(boardRowPlacement({ placer: ACME_PLACER, row: BARE }).kind).toBe("unplaced");
  });

  it("is a conflict when its addresses name both workspaces, carrying every piece of evidence", () => {
    const placement = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, prUrls: [ACME_ADMIN_PR, SLOPWEAVER_PR] },
    });
    expect(placement).toEqual({
      evidence: [
        { source: "repository", value: "acme/acme-admin", workspace: "team" },
        { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
      ],
      kind: "conflict",
    });
  });

  it("is settled by a stated workspace, which keeps what it overruled rather than hiding it", () => {
    const placement = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, prUrls: [ACME_ADMIN_PR, SLOPWEAVER_PR], workspace: "self" },
    });
    expect(placement).toEqual({
      by: [
        { source: "stated", value: "self", workspace: "self" },
        { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
      ],
      kind: "placed",
      overruled: [{ source: "repository", value: "acme/acme-admin", workspace: "team" }],
      workspace: "self",
    });
    expect(findingLabel({ placement })).toEqual({
      label: "stated over a conflict",
      title: "stated self, overruling: repository acme/acme-admin → team",
    });
  });
});
