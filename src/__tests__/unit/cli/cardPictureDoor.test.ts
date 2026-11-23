import { describe, expect, it } from "vitest";

import { cardPictureAcknowledgements } from "../../../cli/cardPictureDoor.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { UpdateArtifact } from "../../../outbound/artifact/types.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";

const CONTEXT: BareRefContext = {
  complianceControls: [],
  linearTeamKeys: ["SECU", "SUP", "OPS"],
  linearWorkspaceSlug: "acme",
  repos: [],
};

/** A briefing-shaped card naming four tickets — the shape a routine composed card takes. */
function fourTicketCard({ media = [] }: { media?: readonly string[] } = {}): UpdateArtifact {
  return {
    citations: [],
    detail: [
      { runs: [{ text: "SECU-101, SUP-102, SECU-103 and OPS-104 landed today", type: "text" }], type: "paragraph" },
    ],
    index: [],
    kind: "update",
    media,
    tldr: "four landed",
  };
}

describe("cardPictureAcknowledgements", () => {
  it("holds a composed card naming four things with no picture, on the one question", () => {
    const errors = unwrapErr(
      cardPictureAcknowledgements({
        artifact: fourTicketCard(),
        context: CONTEXT,
        formKind: "update",
        mediaCount: 0,
        noPictureBecause: undefined,
        scheduled: false,
      }),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain(
      "this message names 4 different things (SECU-101, SUP-102, SECU-103, OPS-104) and attaches no picture: " +
        "which of these would a picture show better than text?",
    );
    expect(errors[0]).toContain('say why with `--no-picture-because "<why>"`');
  });

  it("records the session's reason as an unshown-items acknowledgement on the send", () => {
    expect(
      unwrap(
        cardPictureAcknowledgements({
          artifact: fourTicketCard(),
          context: CONTEXT,
          formKind: "update",
          mediaCount: 0,
          noPictureBecause: "each ticket's page shows only the title this card already quotes",
          scheduled: false,
        }),
      ),
    ).toEqual([
      { reason: "each ticket's page shows only the title this card already quotes", subject: "unshown-items" },
    ]);
  });

  it("counts a --media picture as well as the form's own media", () => {
    expect(
      unwrap(
        cardPictureAcknowledgements({
          artifact: fourTicketCard(),
          context: CONTEXT,
          formKind: "update",
          mediaCount: 1,
          noPictureBecause: undefined,
          scheduled: false,
        }),
      ),
    ).toEqual([]);
    expect(
      unwrap(
        cardPictureAcknowledgements({
          artifact: fourTicketCard({ media: ["/tmp/board.png"] }),
          context: CONTEXT,
          formKind: "update",
          mediaCount: 0,
          noPictureBecause: undefined,
          scheduled: false,
        }),
      ),
    ).toEqual([]);
  });

  it("never asks a derived digest card, however many things it names", () => {
    expect(
      unwrap(
        cardPictureAcknowledgements({
          artifact: fourTicketCard(),
          context: CONTEXT,
          formKind: "digest",
          mediaCount: 0,
          noPictureBecause: undefined,
          scheduled: false,
        }),
      ),
    ).toEqual([]);
  });

  it("never asks a scheduled firing, even on an update form", () => {
    expect(
      unwrap(
        cardPictureAcknowledgements({
          artifact: fourTicketCard(),
          context: CONTEXT,
          formKind: "update",
          mediaCount: 0,
          noPictureBecause: undefined,
          scheduled: true,
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a reason on a derived card, so the ledger never records a waiver for a question never asked", () => {
    expect(
      unwrapErr(
        cardPictureAcknowledgements({
          artifact: fourTicketCard(),
          context: CONTEXT,
          formKind: "alert-summary",
          mediaCount: 0,
          noPictureBecause: "none adds value",
          scheduled: false,
        }),
      ),
    ).toEqual([
      '`--no-picture-because "<why>"` answers a question this card is never asked — it is a derived or ' +
        "scheduled card, which has no session behind it to ask. Remove it.",
    ]);
  });

  it("refuses a reason on a composed card that already attaches a picture", () => {
    expect(
      unwrapErr(
        cardPictureAcknowledgements({
          artifact: fourTicketCard(),
          context: CONTEXT,
          formKind: "update",
          mediaCount: 2,
          noPictureBecause: "none adds value",
          scheduled: false,
        }),
      ),
    ).toEqual([
      '`--no-picture-because "<why>"` answers a question this message was not asked — it already attaches a ' +
        "picture — so there is nothing to record. Remove it.",
    ]);
  });
});
