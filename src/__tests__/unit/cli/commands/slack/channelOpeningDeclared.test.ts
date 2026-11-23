/**
 * `slack draft record` requires an `opening` declaration of a composed form bound for the top level of a channel, and
 * of nothing a DM or a thread reply carries.
 */
import { describe, expect, it } from "vitest";

import { openingUndeclaredRefusals } from "../../../../../cli/commands/slack/channelOpeningDeclared.js";
import { OPENING_UNDECLARED } from "../../../../../outbound/artifact/channelOpening.js";

const COMPOSED = ["drip", "one-card", "one-list", "update", "no-fold"];
const OPENING = { asks: { kind: "nothing", text: "nothing needed from you" }, what: "a pilot of the bot" };

describe("openingUndeclaredRefusals", () => {
  it("refuses every composed form kind bound for a channel's top level that declares nothing", () => {
    expect(
      COMPOSED.map((formKind) =>
        openingUndeclaredRefusals({ artifact: {}, channel: "C0SYN000024", formKind, threadTs: undefined }),
      ),
    ).toEqual(COMPOSED.map(() => [OPENING_UNDECLARED, "NOTHING was parked and nothing was sent."]));
  });

  it("refuses a group conversation's top level too, since a G id reads as a channel", () => {
    expect(
      openingUndeclaredRefusals({ artifact: {}, channel: "G0SYN1ABCDEF", formKind: "one-card", threadTs: undefined }),
    ).toEqual([OPENING_UNDECLARED, "NOTHING was parked and nothing was sent."]);
  });

  it("parks a top-level channel post that declares an opening", () => {
    expect(
      openingUndeclaredRefusals({
        artifact: { opening: OPENING },
        channel: "C0SYN000024",
        formKind: "update",
        threadTs: undefined,
      }),
    ).toEqual([]);
  });

  it("asks nothing of a DM or a member id", () => {
    expect(
      ["D0SYN000009", "U0SYN000013", "W0SYN123ABCD"].map((channel) =>
        openingUndeclaredRefusals({ artifact: {}, channel, formKind: "one-card", threadTs: undefined }),
      ),
    ).toEqual([[], [], []]);
  });

  it("asks nothing of a thread reply, even in a channel", () => {
    expect(
      openingUndeclaredRefusals({
        artifact: {},
        channel: "C0SYN000024",
        formKind: "drip",
        threadTs: "1791871827.186159",
      }),
    ).toEqual([]);
  });

  it("asks nothing of a finding, a derived card or a plain body", () => {
    expect(
      ["finding", "digest", "alert-summary", "plain"].map((formKind) =>
        openingUndeclaredRefusals({ artifact: {}, channel: "C0SYN000024", formKind, threadTs: undefined }),
      ),
    ).toEqual([[], [], [], []]);
  });
});
