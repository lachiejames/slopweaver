import { describe, expect, it } from "vitest";

import { isSafeSlug } from "../../../handover/runStore.js";
import { askNamesChannel, incidentAskText, incidentRegisterArgv, incidentRowSlug } from "../../../incident/row.js";
import { ACME_ORGANISATION, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

const CHECKOUT = { id: "C0SYN000004", name: "inc-2026-09-23-payment-checkout-regression", topic: "INC-98" };
const LINK = "https://example.slack.com/archives/C0SYN000004";

describe("incidentRowSlug", () => {
  it("is the lowered channel id and nothing else", () => {
    expect(incidentRowSlug({ channel: CHECKOUT })).toBe("incident-c0syn000004");
  });

  it("gives a renamed channel the same slug, so two sweeps either side of the rename race for ONE pathname", () => {
    const renamed = { ...CHECKOUT, name: "inc-2026-09-23-payment-checkout-restored" };
    expect(incidentRowSlug({ channel: renamed })).toBe(incidentRowSlug({ channel: CHECKOUT }));
  });

  it("gives two same-titled channels two slugs", () => {
    const first = incidentRowSlug({ channel: { id: "C1" } });
    const second = incidentRowSlug({ channel: { id: "C9" } });
    expect([first, second]).toEqual(["incident-c1", "incident-c9"]);
  });

  it("writes a slug the board accepts", () => {
    expect(isSafeSlug({ slug: incidentRowSlug({ channel: CHECKOUT }) })).toBe(true);
  });
});

describe("incidentAskText", () => {
  it("names the channel, its reference, its id and link, the skill and both lines no investigation crosses", () => {
    expect(incidentAskText({ channel: CHECKOUT, permalink: LINK })).toBe(
      "Investigate the live incident #inc-2026-09-23-payment-checkout-regression (INC-98), channel C0SYN000004, " +
        "https://example.slack.com/archives/C0SYN000004, unasked, by the incident skill (/slopweaver:incident): " +
        "read the channel, Datadog, the deploy and PR timeline, support and the bug-report channels through the " +
        "doors; name the stakeholders; end in ONE floating note via `slopweaver incident note` asking whether to " +
        "share. Nothing is posted and no PR is opened before the owner's yes.",
    );
  });

  it("omits the reference when the channel has no topic", () => {
    const text = incidentAskText({ channel: { id: "C1", name: "inc-2026-09-23-x" }, permalink: LINK });
    expect(text.startsWith("Investigate the live incident #inc-2026-09-23-x, channel C1, ")).toBe(true);
  });
});

describe("incidentRegisterArgv", () => {
  const ORG_LINK = "https://acme.slack.com/archives/C0SYN000004";

  it("writes a p1 dispatch row with the slug, asked time, checkout and home, placed by the organisation's Slack", () => {
    const argv = incidentRegisterArgv({
      channel: CHECKOUT,
      checkout: "/repo",
      home: "/home/sw",
      nowIso: "2026-09-23T01:20:00.000Z",
      organisation: ACME_ORGANISATION,
      permalink: ORG_LINK,
    });
    expect(argv).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      incidentAskText({ channel: CHECKOUT, permalink: ORG_LINK }),
      "--dispatch",
      "--slug",
      "incident-c0syn000004",
      "--priority",
      "p1",
      "--tag",
      "context=work",
      "--workspace",
      "team",
      "--workspace-because",
      "a live incident is in acme.slack.com, the organisation's Slack",
      "--asked-iso",
      "2026-09-23T01:20:00.000Z",
      "--repo",
      "/repo",
      "--home",
      "/home/sw",
    ]);
  });

  it("states no workspace for a channel in any other Slack, rather than guessing the team's", () => {
    for (const permalink of [LINK, "https://othercompany.enterprise.slack.com/archives/C0SYN000004"]) {
      const argv = incidentRegisterArgv({
        channel: CHECKOUT,
        checkout: "/repo",
        home: "/home/sw",
        nowIso: "2026-09-23T01:20:00.000Z",
        organisation: ACME_ORGANISATION,
        permalink,
      });
      expect(argv.includes("--workspace")).toBe(false);
    }
  });

  it("reads the organisation's Slack hosts rather than a constant, so another organisation places its own", () => {
    const placed = ({ permalink }: { permalink: string }): boolean =>
      incidentRegisterArgv({
        channel: CHECKOUT,
        checkout: "/repo",
        home: "/home/sw",
        nowIso: "2026-09-23T01:20:00.000Z",
        organisation: GLOBEX_ORGANISATION,
        permalink,
      }).includes("--workspace");
    expect([
      placed({ permalink: "https://globex-eng.slack.com/archives/C0SYN000004" }),
      placed({ permalink: ORG_LINK }),
    ]).toEqual([true, false]);
  });
});

describe("askNamesChannel", () => {
  it("recognises the ask written for this channel", () => {
    const ask = incidentAskText({ channel: CHECKOUT, permalink: LINK });
    expect(askNamesChannel({ ask, channelId: "C0SYN000004" })).toBe(true);
  });

  it("refuses an ask written for a channel whose id this one's is a prefix of", () => {
    const ask = incidentAskText({
      channel: { ...CHECKOUT, id: "C0SYN0000032" },
      permalink: "https://example.slack.com/archives/C0SYN0000032",
    });
    expect(askNamesChannel({ ask, channelId: "C0SYN000004" })).toBe(false);
  });

  it("refuses prose that only mentions the channel, as a hand-made doc at the same slug might", () => {
    expect(
      askNamesChannel({ ask: "Follow up with channel C0SYN000004, about retention", channelId: "C0SYN000004" }),
    ).toBe(false);
    expect(
      askNamesChannel({
        ask: `channel C0SYN000004, https://example.slack.com/archives/C0OTHER, unasked,`,
        channelId: "C0SYN000004",
      }),
    ).toBe(false);
  });

  it("refuses a link to another host's /archives/<id>, which is not the channel's Slack permalink", () => {
    expect(
      askNamesChannel({
        ask: "Follow up: channel C0SYN000004, http://not-slack.invalid/archives/C0SYN000004, unasked,",
        channelId: "C0SYN000004",
      }),
    ).toBe(false);
  });

  it("refuses a workspace part that is not a valid DNS label", () => {
    for (const host of ["-", "a-", "-a"]) {
      expect(
        askNamesChannel({
          ask: `channel C0SYN000004, https://${host}.slack.com/archives/C0SYN000004, unasked,`,
          channelId: "C0SYN000004",
        }),
      ).toBe(false);
    }
  });

  it("recognises a hyphenated workspace like the live one", () => {
    expect(
      askNamesChannel({
        ask: "channel C0SYN000004, https://acme.slack.com/archives/C0SYN000004, unasked,",
        channelId: "C0SYN000004",
      }),
    ).toBe(true);
  });

  it("recognises the ask written on an Enterprise Grid workspace's permalink", () => {
    const ask = incidentAskText({
      channel: CHECKOUT,
      permalink: "https://acme.enterprise.slack.com/archives/C0SYN000004",
    });
    expect(askNamesChannel({ ask, channelId: "C0SYN000004" })).toBe(true);
  });
});
