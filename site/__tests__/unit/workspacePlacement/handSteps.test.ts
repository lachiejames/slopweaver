import { describe, expect, it } from "vitest";

import { handPlacement, type PlacedBoardFields } from "../../../lib/registerPlacement";
import { findingLabel, shownInContext } from "../../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, acmeBy, BARE, SLOPWEAVER_PR } from "./fixtures";

describe("hand steps", () => {
  const STEP = { cites: [], context: undefined, row: undefined, url: undefined, where: undefined } as const;

  it("inherits the workspace of the board row it unblocks, with no link, context or address", () => {
    const task: PlacedBoardFields = { ...BARE, slug: "acme-task", workspace: "team" };
    const placement = handPlacement({ placer: ACME_PLACER, rows: [task], step: { ...STEP, row: "acme-task" } });
    expect(placement).toEqual({
      by: [
        { source: "board-row", value: "acme-task", workspace: "team" },
        { source: "joined-stated", value: "acme-task states team", workspace: "team" },
      ],
      kind: "placed",
      workspace: "team",
    });
    expect(shownInContext({ context: "slopweaver", placement })).toBe(false);
  });

  it("joins a row its --row and its link both name once, never twice", () => {
    const task: PlacedBoardFields = { ...BARE, slug: "acme-task", workspace: "team" };
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [task],
      step: { ...STEP, row: "acme-task", url: "http://localhost:3000/queue?open=ask%3Aacme-task" },
    });
    expect(placement).toEqual(
      handPlacement({ placer: ACME_PLACER, rows: [task], step: { ...STEP, row: "acme-task" } }),
    );
  });

  it("is a finding when the board row it unblocks is not on the board", () => {
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step: { ...STEP, row: "gone" } })).toEqual({
      kind: "unplaced",
      why: "it was posted with no --context, cites no address, unblocks no placed board row and opens no placed ask",
    });
  });

  it("places a step by the context it was posted with", () => {
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step: { ...STEP, context: "work" } })).toEqual(
      acmeBy({ source: "stated", value: "team" }),
    );
  });

  it("places a step by an address it cites", () => {
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step: { ...STEP, cites: [SLOPWEAVER_PR] } })).toEqual({
      by: [{ source: "repository", value: "octo-self/slopweaver", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
  });

  it("places a step by the address it sends the owner to", () => {
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step: { ...STEP, where: ACME_ADMIN_PR } })).toEqual(
      acmeBy({ source: "repository", value: "acme/acme-admin" }),
    );
  });

  it("marks a stated context that overrules the address it sends the owner to", () => {
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [],
      step: { ...STEP, context: "slopweaver", where: ACME_ADMIN_PR },
    });
    expect(findingLabel({ placement })).toEqual({
      label: "stated over a conflict",
      title: "stated self, overruling: repository acme/acme-admin → team",
    });
  });

  it("reads no workspace out of a console link — the console draws both, so it names neither", () => {
    expect(
      handPlacement({
        placer: ACME_PLACER,
        rows: [],
        step: { ...STEP, context: "work", where: "http://localhost:3000/queue" },
      }),
    ).toEqual(acmeBy({ source: "stated", value: "team" }));
  });

  it("reads no workspace out of a where that is prose", () => {
    expect(
      handPlacement({ placer: ACME_PLACER, rows: [], step: { ...STEP, where: "the acme-admin repo settings page" } })
        .kind,
    ).toBe("unplaced");
  });

  it("inherits the workspace of the ask its link opens", () => {
    const ask: PlacedBoardFields = { ...BARE, prUrls: [ACME_ADMIN_PR], slug: "iso-compliance-violations-bigtask" };
    expect(
      handPlacement({
        placer: ACME_PLACER,
        rows: [ask],
        step: { ...STEP, url: "http://localhost:3000/queue?open=ask%3Aiso-compliance-violations-bigtask" },
      }),
    ).toEqual({
      by: [
        { source: "board-row", value: "iso-compliance-violations-bigtask", workspace: "team" },
        { source: "repository", value: "acme/acme-admin", workspace: "team" },
      ],
      kind: "placed",
      workspace: "team",
    });
  });

  it("names the joined ask's ADDRESS, not only its slug, when its own stated workspace overrules that ask", () => {
    const ask: PlacedBoardFields = { ...BARE, prUrls: [ACME_ADMIN_PR], slug: "a" };
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [ask],
      step: { ...STEP, context: "slopweaver", url: "http://localhost:3000/queue?open=ask%3Aa" },
    });
    expect(findingLabel({ placement })).toEqual({
      label: "stated over a conflict",
      title: "stated self, overruling: board-row a → team; repository acme/acme-admin → team",
    });
  });

  it("carries the ask's own 'stated over a conflict' mark when its link opens one", () => {
    const ask: PlacedBoardFields = { ...BARE, prUrls: [ACME_ADMIN_PR], slug: "settled", workspace: "self" };
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [ask],
      step: { ...STEP, url: "http://localhost:3000/queue?open=ask%3Asettled" },
    });
    expect(placement).toEqual({
      by: [
        { source: "board-row", value: "settled", workspace: "self" },
        { source: "joined-stated", value: "settled states self", workspace: "self" },
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

  it("inherits a plain stated workspace from the ask it opens over its own contrary cite, marked", () => {
    const ask: PlacedBoardFields = { ...BARE, slug: "a", workspace: "self" };
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [ask],
      step: { ...STEP, cites: [ACME_ADMIN_PR], url: "http://localhost:3000/queue?open=ask%3Aa" },
    });
    expect(placement).toEqual({
      by: [
        { source: "board-row", value: "a", workspace: "self" },
        { source: "joined-stated", value: "a states self", workspace: "self" },
      ],
      kind: "placed",
      overruled: [{ source: "repository", value: "acme/acme-admin", workspace: "team" }],
      workspace: "self",
    });
  });

  describe("over an ask whose two statements conflict", () => {
    const conflicted: PlacedBoardFields = {
      ...BARE,
      slug: "a",
      tags: [{ key: "context", source: "declared", value: "slopweaver" }],
      tagsIncomplete: false,
      tagsRead: "whole",
      workspace: "team",
    };
    const url = "http://localhost:3000/queue?open=ask%3Aa";

    it("is placed by its own --context, the ask's statements a tier below it and named as overruled", () => {
      expect(
        handPlacement({ placer: ACME_PLACER, rows: [conflicted], step: { ...STEP, context: "work", url } }),
      ).toEqual({
        by: [
          { source: "stated", value: "team", workspace: "team" },
          { source: "joined-stated", value: "a states team", workspace: "team" },
        ],
        kind: "placed",
        overruled: [{ source: "joined-stated", value: "a states context=slopweaver", workspace: "self" }],
        workspace: "team",
      });
    });

    it("carries the conflict when it states nothing of its own", () => {
      expect(handPlacement({ placer: ACME_PLACER, rows: [conflicted], step: { ...STEP, url } }).kind).toBe("conflict");
    });
  });

  it("is placed by its own --context over the ruling of the ask its link opens", () => {
    const ask: PlacedBoardFields = { ...BARE, prUrls: [SLOPWEAVER_PR], slug: "settled", workspace: "team" };
    const placement = handPlacement({
      placer: ACME_PLACER,
      rows: [ask],
      step: { ...STEP, context: "slopweaver", url: "http://localhost:3000/queue?open=ask%3Asettled" },
    });
    expect(placement).toEqual({
      by: [
        { source: "stated", value: "self", workspace: "self" },
        { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
      ],
      kind: "placed",
      overruled: [
        { source: "board-row", value: "settled", workspace: "team" },
        { source: "joined-stated", value: "settled states team", workspace: "team" },
      ],
      workspace: "self",
    });
  });

  it("leaves a step with nothing but words unplaced", () => {
    expect(handPlacement({ placer: ACME_PLACER, rows: [], step: STEP }).kind).toBe("unplaced");
  });
});
