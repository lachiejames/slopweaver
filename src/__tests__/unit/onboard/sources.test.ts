/**
 * The five-source declaration `slopweaver onboard` renders from.
 *
 * The assertions worth having here are the ones a reader of the copy cannot make for themselves: that
 * Gmail is present at all, that its shown-once secret warning renders BEFORE the step that creates the
 * secret, that the block names credentials and never spells a command, and that a bot-only step vanishes
 * on the tier with no bot.
 */
import { describe, expect, it } from "vitest";

import {
  connectSourceLines,
  GMAIL_CLIENT_TYPE_REASON,
  GMAIL_REQUIRED_APIS,
  GMAIL_SECRET_WARNING,
  ONBOARD_SOURCES,
  SOURCE_SPECS,
  sourceLines,
} from "../../../onboard/sources.js";

describe("ONBOARD_SOURCES", () => {
  it("names every connectable source, the two mailboxes after the original four", () => {
    expect([...ONBOARD_SOURCES]).toEqual(["github", "slack", "linear", "notion", "gmail", "outlook"]);
  });

  it("gives every source a spec whose own source field matches its key", () => {
    expect(ONBOARD_SOURCES.map((source) => SOURCE_SPECS[source].source)).toEqual([...ONBOARD_SOURCES]);
  });

  it("marks the two mailboxes as the sources refresh --all-sources does not reach", () => {
    expect(ONBOARD_SOURCES.filter((source) => !SOURCE_SPECS[source].inAllSources)).toEqual(["gmail", "outlook"]);
  });
});

describe("sourceLines", () => {
  it("puts the shown-once warning ABOVE the step that creates the secret", () => {
    const lines = sourceLines({ hasBot: true, source: "gmail" });
    const warning = lines.findIndex((line) => line.includes("shows the client secret ONCE"));
    const create = lines.findIndex((line) => line.includes("Create credentials"));

    expect(warning).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(warning);
  });

  it("sends the secret to the reader's own password manager, naming no product, before the page is closed", () => {
    expect(GMAIL_SECRET_WARNING).toContain("into your password manager, then capture them below");
    expect(GMAIL_SECRET_WARNING).not.toMatch(/1password/iu);
    expect(GMAIL_SECRET_WARNING).toContain("Before you close that dialog");
  });

  it("names each credential without spelling a command to run", () => {
    const text = sourceLines({ hasBot: true, source: "gmail" }).join("\n");

    expect(text).toContain("capture as: google-client-id");
    expect(text).toContain("capture as: google-client-secret");
    expect(text).not.toContain("slopweaver secrets set");
  });

  it("drops the bot-token step on a tier that provisions no bot", () => {
    expect(sourceLines({ hasBot: true, source: "slack" }).join("\n")).toContain("slack-bot-token");
    expect(sourceLines({ hasBot: false, source: "slack" }).join("\n")).not.toContain("slack-bot-token");
  });

  it("says on the gmail block that --all-sources skips it", () => {
    expect(sourceLines({ hasBot: true, source: "gmail" })[0]).toContain("--all-sources` skips it");
    expect(sourceLines({ hasBot: true, source: "slack" })[0]).not.toContain("--all-sources");
  });
});

describe("connectSourceLines", () => {
  it("has at least one entry in GMAIL_REQUIRED_APIS, so the guards below are not vacuously green", () => {
    expect(GMAIL_REQUIRED_APIS.length).toBeGreaterThan(0);
  });

  it("names the Desktop-app client type and the reason a Web application client fails", () => {
    expect(GMAIL_CLIENT_TYPE_REASON).toContain("DESKTOP APP");
    expect(GMAIL_CLIENT_TYPE_REASON).toContain("redirect_uri_mismatch");
    expect(connectSourceLines({ hasBot: true }).join("\n")).toContain(GMAIL_CLIENT_TYPE_REASON);
  });

  it("names both Google APIs that have to be enabled, each with the page that enables it", () => {
    const text = connectSourceLines({ hasBot: true }).join("\n");
    for (const api of GMAIL_REQUIRED_APIS) {
      expect(text).toContain(api.name);
      expect(text).toContain(api.page);
    }
  });

  it("lists every source in declaration order", () => {
    const text = connectSourceLines({ hasBot: true }).join("\n");
    const positions = ONBOARD_SOURCES.map((source) => text.indexOf(`\n  ${source}`));

    expect(positions.filter((position) => position < 0)).toEqual([]);
    expect(positions).toEqual([...positions].toSorted((a, b) => a - b));
  });

  it("renders Outlook as a corpus source, in its place after Gmail", () => {
    const text = connectSourceLines({ hasBot: true }).join("\n");
    const gmail = text.indexOf("\n  gmail");
    const outlook = text.indexOf("\n  outlook");

    expect(gmail).toBeGreaterThan(-1);
    expect(outlook).toBeGreaterThan(gmail);
  });
});
