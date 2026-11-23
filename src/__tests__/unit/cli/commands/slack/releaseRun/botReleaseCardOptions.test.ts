import { describe, expect, it } from "vitest";
import { botReleaseCardOptions } from "../../../../../../cli/commands/slack/releaseBotRun.js";
import type { ParkedSlackDraft } from "../../../../../../outbound/slack/draftRegister.js";
import { FORM, heldRow, releaseOf, VIDEO, verifiedOf } from "./fixtures.js";

describe("botReleaseCardOptions", () => {
  it("sends the row's form to its channel as an approved bot draft, carrying its verified media keys", () => {
    const row: ParkedSlackDraft = { ...heldRow(), actor: "bot", channel: "C0SYN000008" };
    const media = new Map([["draft-media/1/k/a.png", verifiedOf({ record: VIDEO })]]);
    expect(
      botReleaseCardOptions({
        options: { ...releaseOf({ approve: row.digest }), actor: "bot", dryRun: true },
        row: { draft: row, formJson: FORM, heldCuts: [], media },
      }),
    ).toEqual({
      actor: "bot",
      allowUnresolvedOwner: false,
      approvedDraft: true,
      channel: "C0SYN000008",
      dryRun: true,
      formJson: FORM,
      home: "/unused",
      json: false,
      media: ["draft-media/1/k/a.png"],
      resendUnconfirmed: false,
      verb: "post",
    });
  });
});
