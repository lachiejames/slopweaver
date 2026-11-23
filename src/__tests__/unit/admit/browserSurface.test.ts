/**
 * {@link classifyBrowserUrl} — the browser write-policy register the Playwright verbs read.
 *
 * The Slack URL is the incident's own host. Only the URL's PATH is synthetic — the hostname is
 * what every rule here reads, and a real workspace or channel id has no business in a committed file. The
 * page-by-page Claude-in-Chrome engine these cases once sat beside was deleted as unreachable; the
 * retirement that replaced it is proven in `browserDoorGuardRunner.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { classifyBrowserUrl } from "../../../admit/browserSurface.js";
import { bareToolName } from "../../../admit/browserVerdictVocabulary.js";

/** The incident's tab URL: the Slack web client, in the owner's own signed-in Chrome. */
const INCIDENT_URL = "https://app.slack.com/client/workspace/channel";

describe("classifyBrowserUrl", () => {
  it("names Slack for the incident's own URL", () => {
    expect(classifyBrowserUrl({ url: INCIDENT_URL })!.provider).toBe("Slack");
  });

  it("names each doored provider", () => {
    expect(classifyBrowserUrl({ url: "https://github.com/acme/acme-admin/pull/16424/files" })!.provider).toBe("GitHub");
    expect(classifyBrowserUrl({ url: "https://linear.app/team/issue/ABC-1" })!.provider).toBe("Linear");
    expect(classifyBrowserUrl({ url: "https://www.notion.so/Some-Page-abc123" })!.provider).toBe("Notion");
  });

  it("matches a subdomain but not a lookalike host that merely contains the name", () => {
    expect(classifyBrowserUrl({ url: "https://app.slack.com/client/X" })!.provider).toBe("Slack");
    expect(classifyBrowserUrl({ url: "https://github.com.example.invalid/acme" })).toBe(undefined);
    expect(classifyBrowserUrl({ url: "https://notgithub.com/x" })).toBe(undefined);
  });

  it("accepts the bare host spelling with no scheme", () => {
    expect(classifyBrowserUrl({ url: "app.slack.com/client/E0SYN000001" })!.provider).toBe("Slack");
  });

  it("leaves an UNREGISTERED surface, a schemeless page and an empty string unclassified", () => {
    // Unclassified is no longer "no opinion" — it is UNREGISTERED_WRITE_POLICY, refuse-every-write, by the
    // owner's ruling. Datadog used to be the example here and is now in the register.
    expect(classifyBrowserUrl({ url: "https://dashboard.workos.com/users" })).toBe(undefined);
    expect(classifyBrowserUrl({ url: "about:blank" })).toBe(undefined);
    expect(classifyBrowserUrl({ url: "" })).toBe(undefined);
  });
});

describe("Vanta joined the doored providers when its write verb shipped", () => {
  it("names Vanta and its door for the workspace host", () => {
    const provider = classifyBrowserUrl({ url: "https://app.vanta.com/tests" })!;
    expect(provider.provider).toBe("Vanta");
    expect(provider.door).toContain("slopweaver atlas vanta shot --control <id>");
  });

  // Weekend dogfood P17: a bot answer told the owner a Vanta page could not be photographed while
  // `atlas vanta render` sat one verb away. The door named `--html` for the vulnerabilities LIST and
  // nothing for any other page, so it read as an exhaustive list of the screenshot routes it had.
  // The same rot recurred against a newer verb: `atlas vanta shot --control <id>` shipped
  // and updated no surface that tells a caller it exists, so a turn
  // answering a Vanta CONTROL question still had no photograph route it could see. It leads the string
  // because P17's lesson is that a reader takes the first named route as the answer.
  it("names shot and render as screenshot routes, with shot leading and render's STORED caveat intact", () => {
    expect(classifyBrowserUrl({ url: "https://app.vanta.com/tests" })!.door).toBe(
      "slopweaver atlas vanta shot --control <id> (photographs ONE control at its own address and refuses " +
        "an id the atlas cannot place — a picture of the controls INDEX proves nothing about one control) / " +
        "atlas vanta vulnerabilities (--html for a screenshot-able findings list) / atlas vanta " +
        "render [--out <path>] (screenshot-able HTML of what the atlas ALREADY STORED, reaching Vanta not at " +
        "all — so `atlas vanta walk` is what photographs a live page into it first, and render alone shows " +
        "you nothing nobody walked) / atlas vanta read / atlas vanta " +
        "sync / write vanta deactivate",
    );
  });

  it("matches the registrable host itself as well as a subdomain", () => {
    expect(classifyBrowserUrl({ url: "https://vanta.com" })!.provider).toBe("Vanta");
  });

  it("does not match a stranger host that merely ends in the same letters", () => {
    expect(classifyBrowserUrl({ url: "https://vanta.com.example.invalid" })).toBe(undefined);
  });
});

describe("the two categories are declared per platform", () => {
  it("puts all five doored providers in read-before-write", () => {
    const urls = [
      "https://app.vanta.com/tests",
      "https://app.slack.com/client/X",
      "https://github.com/o/r/pull/1",
      "https://linear.app/team/issue/ABC-1",
      "https://www.notion.so/Page",
    ];
    expect(urls.map((url) => classifyBrowserUrl({ url })!.policy)).toEqual([
      "read-before-write",
      "read-before-write",
      "read-before-write",
      "read-before-write",
      "read-before-write",
    ]);
  });

  it("classifies the platforms left unregistered as strangers, which is how they inherit the default", () => {
    const urls = ["https://admin.google.com/", "https://falcon.crowdstrike.com/", "https://dash.cloudflare.com/"];
    expect(urls.map((url) => classifyBrowserUrl({ url }))).toEqual([undefined, undefined, undefined]);
  });

  it("names JumpCloud, which the register moved from the default into the register BY NAME", () => {
    expect(classifyBrowserUrl({ url: "https://console.jumpcloud.com/" })!.provider).toBe("JumpCloud");
  });

  it("gives it the refusing policy, so it is the register's first entry that exists to refuse", () => {
    expect(classifyBrowserUrl({ url: "https://console.jumpcloud.com/" })!.policy).toBe("refuse-every-write");
  });
});

describe("bareToolName", () => {
  it("strips the Claude-in-Chrome prefix, so a refusal names the tool as its schema does", () => {
    expect(bareToolName({ toolName: "mcp__claude-in-chrome__computer" })).toBe("computer");
  });

  it("leaves a name without the prefix untouched", () => {
    expect(bareToolName({ toolName: "navigate" })).toBe("navigate");
  });
});
