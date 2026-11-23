import { describe, expect, it } from "vitest";

import { draftPlacement, postPlacement } from "../../../lib/registerPlacementDirect";
import { ACME_PLACER } from "../../organisationFixture";
import { acmeBy } from "./fixtures";

describe("held replies and parked posts — the installation's Slack registers", () => {
  it("places a held reply in team by its register, and by its permalink's host", () => {
    expect(
      draftPlacement({ draft: { permalink: "https://acme.slack.com/archives/C1/p1" }, placer: ACME_PLACER }),
    ).toEqual({
      by: [
        { source: "slack-workspace", value: "the held-reply register", workspace: "team" },
        { source: "slack-workspace", value: "acme.slack.com/archives/C1/p1", workspace: "team" },
      ],
      kind: "placed",
      workspace: "team",
    });
  });

  it("places a parked post in team by the register it was drafted into", () => {
    expect(postPlacement({ post: { channel: "C0SYN000001" } })).toEqual(
      acmeBy({ source: "slack-workspace", value: "the drafts register, C0SYN000001" }),
    );
  });
});
