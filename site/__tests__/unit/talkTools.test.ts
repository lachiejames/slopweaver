/*
 * The console voice's tool list: exactly one tool relays, it is answered in the page (through the gate),
 * and a tool list that drifts from the verb's — in names OR in which ones write — refuses the session.
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { BUDGETED_LOOK_WORST_CASE_MS } from "../../../src/browser/lookBudget";
import { refuseOnToolDrift } from "../../components/live/talkSession";
import { TALK_TOOL_NAMES, TALK_WRITER_NAMES, talkArgvFor, talkToolFor } from "../../lib/talkTools";
import { BROWSER_TIMEOUT_MS, TALK_TOOLS, type TalkTool, TOOL_TIMEOUT_MS } from "../../lib/talkToolsList";

describe("BROWSER_TIMEOUT_MS", () => {
  it("is 213 s of capped look, attach shutdown grace, foreground probes and the Slack app attempt included, plus 10 s of local work", () => {
    expect(BUDGETED_LOOK_WORST_CASE_MS).toBe(213_000);
    expect(BROWSER_TIMEOUT_MS - BUDGETED_LOOK_WORST_CASE_MS).toBe(10_000);
  });

  it("gives every browser tool that budget, and no other tool", () => {
    const browserTools = TALK_TOOLS.filter((tool) => tool.where === "verb" && tool.timeoutMs === BROWSER_TIMEOUT_MS);
    expect(browserTools.map((tool) => tool.name)).toEqual(["browser", "browser_open"]);
  });
});

describe("TALK_TOOLS", () => {
  it("runs the same thirty-six tools the verb declares, in its order", () => {
    expect(TALK_TOOL_NAMES).toEqual([
      "code_find",
      "code_read",
      "code_list",
      "file_read",
      "file_list",
      "action_items",
      "read_card",
      "open_card",
      "draft_edit_start",
      "draft_edit",
      "draft_restore",
      "triage_next",
      "triage_end",
      "triage_clock",
      "read_page",
      "read_screen",
      "focus_screen",
      "offer_copy",
      "running_list",
      "set_stage_setting",
      "focus_set",
      "focus_end",
      "focus_quiet",
      "meeting_skip",
      "board_row",
      "read_supervisor",
      "glossary",
      "origin",
      "knowledge",
      "supervisor_history",
      "recall",
      "recall_open",
      "verb",
      "browser",
      "browser_open",
      "slack_thread_after",
      "slack_unread",
      "slack_channel",
      "slack_open",
      "slack_send_outcome",
      "recent_steers",
      "relay_steer",
    ]);
  });

  it("has the relay and the two draft writes as its writers, each answered in the page that aims it", () => {
    expect(TALK_TOOLS.length).toBeGreaterThan(0);
    expect(TALK_WRITER_NAMES).toEqual(["draft_edit", "draft_restore", "relay_steer"]);
    expect(TALK_TOOLS.filter((tool) => tool.does === "relay").map((tool) => tool.name)).toEqual(["relay_steer"]);
    expect(TALK_WRITER_NAMES.map((name) => talkToolFor({ name })!.where)).toEqual(["page", "page", "page"]);
    expect(TALK_TOOLS.filter((tool) => tool.does === "show").map((tool) => tool.name)).toEqual(["focus_screen"]);
    expect(talkToolFor({ name: "relay_steer" })!.where).toBe("page");
  });

  it("answers offer_copy in the page as the one list-write, never a relay writer", () => {
    expect(TALK_TOOLS.filter((tool) => tool.does === "list-write")).toEqual([
      { does: "list-write", name: "offer_copy", where: "page" },
    ]);
  });

  it("reads the running list through talk list, voice-safe, as a read taking no arguments", () => {
    expect(talkToolFor({ name: "running_list" })).toEqual({
      argv: ["talk", "list", "--voice-safe", "--json"],
      does: "read",
      name: "running_list",
      options: [],
      timeoutMs: TOOL_TIMEOUT_MS,
      title: "slopweaver talk list --voice-safe --json",
      where: "verb",
    });
    const verb = talkToolFor({ name: "running_list" }) as Extract<TalkTool, { where: "verb" }>;
    expect(talkArgvFor({ args: {}, tool: verb })).toEqual({
      argv: ["talk", "list", "--voice-safe", "--json"],
      kind: "argv",
    });
  });

  it("answers the triage clock, the stage switch, the drift watch's three and the meeting skip in the page as preferences, never a writer", () => {
    const preferences = ["triage_clock", "set_stage_setting", "focus_set", "focus_end", "focus_quiet", "meeting_skip"];
    expect(TALK_TOOLS.filter((tool) => tool.does === "preference").map((tool) => tool.name)).toEqual(preferences);
    expect(preferences.map((name) => talkToolFor({ name })!.where)).toEqual([
      "page",
      "page",
      "page",
      "page",
      "page",
      "page",
    ]);
  });

  it("answers read_card and open_card in the page as reads, so the relay gate counts what they hand the model", () => {
    expect(talkToolFor({ name: "read_card" })).toEqual({ does: "read", name: "read_card", where: "page" });
    expect(talkToolFor({ name: "open_card" })).toEqual({ does: "read", name: "open_card", where: "page" });
  });

  it("reads a board row by slug through the talk row verb, refusing a slug shaped like a flag", () => {
    const tool = talkToolFor({ name: "board_row" })!;
    expect(tool.where).toBe("verb");
    const verb = tool as Extract<typeof tool, { where: "verb" }>;
    expect(talkArgvFor({ args: { slug: "acme-ask-6-sep-turn-95-1-give" }, tool: verb })).toEqual({
      argv: ["talk", "row", "--slug", "acme-ask-6-sep-turn-95-1-give", "--json"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { slug: "--home" }, tool: verb }).kind).toBe("refused");
  });

  it("reads one Slack thread live through talk slack-after, refusing a link shaped like a flag", () => {
    const tool = talkToolFor({ name: "slack_thread_after" })!;
    expect(tool.where).toBe("verb");
    const verb = tool as Extract<typeof tool, { where: "verb" }>;
    const url = "https://acme.slack.com/archives/C123/p1785114398557099?thread_ts=1785114000.000100&cid=C123";
    expect(talkArgvFor({ args: { url }, tool: verb })).toEqual({
      argv: ["talk", "slack-after", "--url", url, "--json"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { url: "--home" }, tool: verb }).kind).toBe("refused");
  });

  it("reads one Slack channel live through talk slack-channel, refusing a channel shaped like a flag", () => {
    const tool = talkToolFor({ name: "slack_channel" })!;
    expect(tool.where).toBe("verb");
    const verb = tool as Extract<typeof tool, { where: "verb" }>;
    expect(verb.does).toBe("read");
    expect(talkArgvFor({ args: { channel: "#squad-platform" }, tool: verb })).toEqual({
      argv: ["talk", "slack-channel", "--channel", "#squad-platform", "--json"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { channel: "--home" }, tool: verb }).kind).toBe("refused");
  });

  it("reads any local file by absolute or ~/ path through talk file read, refusing a relative one", () => {
    const tool = talkToolFor({ name: "file_read" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    expect(tool.does).toBe("read");
    expect(talkArgvFor({ args: { from: 335, path: "~/.slopweaver/pages/x/index.html" }, tool })).toEqual({
      argv: ["talk", "file", "read", "--path", "~/.slopweaver/pages/x/index.html", "--json", "--from", "335"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { path: "notes.txt" }, tool })).toEqual({
      kind: "refused",
      why: "path is not a whole path: give one starting / or ~/",
    });
    expect(talkArgvFor({ args: { path: "--home" }, tool })).toEqual({
      kind: "refused",
      why: "path is not a whole path: give one starting / or ~/",
    });
    expect(talkArgvFor({ args: { path: "~user/x" }, tool })).toEqual({
      kind: "refused",
      why: "path is not a whole path: give one starting / or ~/",
    });
  });

  // A briefing cut to fit a card could only be continued in the WORDS' byte coordinates,
  // which file_read had no way to ask for, so the voice guessed a raw-markup offset and skipped part of it.
  it("reads a page as its words with a bare --words when words is true, nothing when false, refusing a non-boolean", () => {
    const tool = talkToolFor({ name: "file_read" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    const path = "/h/.slopweaver/pages/x/index.html";
    expect([
      talkArgvFor({ args: { from: 18_431, path, words: true }, tool }),
      talkArgvFor({ args: { path, words: false }, tool }),
      talkArgvFor({ args: { path, words: "yes" }, tool }),
    ]).toEqual([
      { argv: ["talk", "file", "read", "--path", path, "--json", "--from", "18431", "--words"], kind: "argv" },
      { argv: ["talk", "file", "read", "--path", path, "--json"], kind: "argv" },
      { kind: "refused", why: "words must be true or false" },
    ]);
  });

  it("lists a local directory through talk file list with its --dir", () => {
    const tool = talkToolFor({ name: "file_list" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    expect(talkArgvFor({ args: { dir: "/Users/me/Downloads" }, tool })).toEqual({
      argv: ["talk", "file", "list", "--dir", "/Users/me/Downloads", "--json"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { dir: "~" }, tool })).toEqual({
      argv: ["talk", "file", "list", "--dir", "~", "--json"],
      kind: "argv",
    });
  });

  it("carries a verb request as ONE hex token, so a flag the model names never reaches the gateway's argv", () => {
    const tool = talkToolFor({ name: "verb" })! as Extract<ReturnType<typeof talkToolFor> & object, { where: "verb" }>;
    const request = { args: ["--home", "/tmp"], noun: "store", verb: "query" };
    const hex = Buffer.from(JSON.stringify(request), "utf8").toString("hex");
    expect(talkArgvFor({ args: { request }, tool })).toEqual({
      argv: ["talk", "verb", "--request", hex, "--json"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { request: "github read" }, tool })).toEqual({
      kind: "refused",
      why: "request must be an object with noun, verb and args",
    });
  });

  it("opens a page through browser inspect with the address as its --url value", () => {
    const tool = talkToolFor({ name: "browser" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    expect(talkArgvFor({ args: { url: "https://ap1.datadoghq.com/dashboard/abc-123" }, tool })).toEqual({
      argv: ["browser", "inspect", "--url", "https://ap1.datadoghq.com/dashboard/abc-123", "--json"],
      kind: "argv",
    });
  });

  it("refuses a browser look at a Slack message link, naming slack_open, and lets browser_open show it", () => {
    const link = "https://acme.slack.com/archives/C123/p1785114458000100?thread_ts=1785114398.557099&cid=C123";
    const look = talkToolFor({ name: "browser" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    const show = talkToolFor({ name: "browser_open" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    expect(talkArgvFor({ args: { url: link }, tool: look })).toEqual({
      kind: "refused",
      why: "a Slack message link is a thread, read whole with slack_open, never through the browser; use browser_open only when the owner asked to see or pull it up",
    });
    expect(talkArgvFor({ args: { url: link }, tool: show })).toEqual({
      argv: ["browser", "present", "--json", "--url", link],
      kind: "argv",
    });
  });

  it("refuses a browser look at a GitHub pull request, issue or discussion, naming github read, and still shows one", () => {
    // The answering turn runs `browser inspect` on the PR the owner has on screen.
    const look = talkToolFor({ name: "browser" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    const show = talkToolFor({ name: "browser_open" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    // Each spelling against the bare-host link the refusal hands back, the only host `github read` takes.
    const links: readonly (readonly [string, string])[] = [
      ["https://github.com/acme/acme-admin/pull/19057", "https://github.com/acme/acme-admin/pull/19057"],
      [" https://github.com/acme/acme-admin/pull/19057/files ", "https://github.com/acme/acme-admin/pull/19057"],
      [
        "https://github.com/acme/acme-admin/pull/19057#discussion_r123",
        "https://github.com/acme/acme-admin/pull/19057",
      ],
      ["https://github.com/lachiejames/slopweaver/issues/12", "https://github.com/lachiejames/slopweaver/issues/12"],
      [
        "https://github.com/lachiejames/slopweaver/discussions/3?sort=new",
        "https://github.com/lachiejames/slopweaver/discussions/3",
      ],
      [
        "https://www.github.com/lachiejames/slopweaver/issues/12?sort=new#issuecomment-1",
        "https://github.com/lachiejames/slopweaver/issues/12",
      ],
      [
        "https://github.com:443/owner/repo/pull/1/files?diff=split#discussion_r123",
        "https://github.com/owner/repo/pull/1",
      ],
      ["HTTPS://GitHub.com/owner/repo/Pull/1", "https://github.com/owner/repo/pull/1"],
      ["https://github.com./owner/repo/pull/1", "https://github.com/owner/repo/pull/1"],
      ["https://github.com/owner/repo/pull/1.diff", "https://github.com/owner/repo/pull/1"],
      ["https://github.com/owner/repo/pull/1.patch", "https://github.com/owner/repo/pull/1"],
      ["https://github.com/owner/repo/issues/1x", "https://github.com/owner/repo/issues/1"],
      ["https://github.com/owner/repo/pull/2147483647", "https://github.com/owner/repo/pull/2147483647"],
      ["https://github.com/octocat/Hello-World/%69ssues/1", "https://github.com/octocat/Hello-World/issues/1"],
      ["https://github.com/owner/repo/pull/007", "https://github.com/owner/repo/pull/7"],
      // github read reads any other one subpage of a pull request as the pull request itself.
      [
        "https://github.com/lachiejames/slopweaver/pull/2568/xyz",
        "https://github.com/lachiejames/slopweaver/pull/2568",
      ],
      // A malformed escape in the subpage still names the pull request in front of it.
      ["https://github.com/owner/repo/pull/123/files%", "https://github.com/owner/repo/pull/123"],
    ];
    expect(links.map(([url]) => talkArgvFor({ args: { url }, tool: look }))).toEqual(
      links.map(([, readable]) => ({
        kind: "refused",
        why: `a GitHub pull request, issue or discussion is read with verb github read ${readable} --json (add --files for a pull request's changed files), never through the owner's browser, and one already on their screen is in the frame; if github read cannot read it, say it is unread; use browser_open only when they asked to see or pull it up`,
      })),
    );
    const shown = "https://github.com/acme/acme-admin/pull/19057";
    expect(talkArgvFor({ args: { url: shown }, tool: show })).toEqual({
      argv: ["browser", "present", "--json", "--url", shown],
      kind: "argv",
    });
  });

  it("still looks at a GitHub page that is not an issue, pull request or discussion, such as an Actions run", () => {
    const look = talkToolFor({ name: "browser" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    const pages = [
      "https://github.com/lachiejames/slopweaver",
      "https://github.com/lachiejames/slopweaver/actions/runs/123",
      "https://github.com/lachiejames/slopweaver/pull/new/branch",
      "https://github.com/lachiejames/slopweaver/pulls",
      "https://github.com/owner/repo/issues/0",
      // Past GraphQL's Int, which github read's query cannot carry.
      "https://github.com/owner/repo/pull/2147483648",
      // Views github read does not carry: one commit of a pull request, and its checks.
      "https://github.com/owner/repo/pull/1/commits/abc123",
      "https://github.com/owner/repo/pull/1/checks",
      "https://github.com/owner/repo/pull/1/commits",
      // A port that is not the scheme's default is a different origin.
      "https://github.com:65535/owner/repo/issues/1",
      "http://github.com:443/owner/repo/pull/1",
    ];
    expect(pages.map((url) => talkArgvFor({ args: { url }, tool: look }))).toEqual(
      pages.map((url) => ({ argv: ["browser", "inspect", "--url", url, "--json"], kind: "argv" })),
    );
  });

  it("still looks at a Slack page that is not a message link, such as a canvas", () => {
    const canvas = "https://acme.slack.com/docs/T123/F0456";
    const look = talkToolFor({ name: "browser" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    expect(talkArgvFor({ args: { url: canvas }, tool: look })).toEqual({
      argv: ["browser", "inspect", "--url", canvas, "--json"],
      kind: "argv",
    });
  });

  it("takes the owner to a page through browser present, a destination or an address, as a read", () => {
    const tool = talkToolFor({ name: "browser_open" })! as Extract<
      ReturnType<typeof talkToolFor> & object,
      { where: "verb" }
    >;
    expect(tool.does).toBe("read");
    expect(talkArgvFor({ args: { destination: "datadog" }, tool })).toEqual({
      argv: ["browser", "present", "--json", "--destination", "datadog"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { url: "https://linear.app/o/issue/X-1" }, tool })).toEqual({
      argv: ["browser", "present", "--json", "--url", "https://linear.app/o/issue/X-1"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { page: "tobias-one-on-one-2-oct" }, tool })).toEqual({
      argv: ["browser", "present", "--json", "--page", "tobias-one-on-one-2-oct"],
      kind: "argv",
    });
    expect(talkArgvFor({ args: { destination: "--home" }, tool }).kind).toBe("refused");
    expect(talkArgvFor({ args: { page: "--home" }, tool }).kind).toBe("refused");
  });
});

describe("refuseOnToolDrift", () => {
  it("agrees when names and writers match", () => {
    expect(
      refuseOnToolDrift({
        declared: TALK_TOOL_NAMES,
        declaredWriters: ["draft_edit", "draft_restore", "relay_steer"],
        runnable: TALK_TOOL_NAMES,
        runnableWriters: TALK_WRITER_NAMES,
      }),
    ).toBe(undefined);
  });

  it("refuses when the verb declares a writer this page would run as a read", () => {
    expect(
      refuseOnToolDrift({
        declared: TALK_TOOL_NAMES,
        declaredWriters: ["draft_edit", "draft_restore", "relay_steer", "board_row"],
        runnable: TALK_TOOL_NAMES,
        runnableWriters: TALK_WRITER_NAMES,
      }),
    ).toBe(
      "the tool lists disagree: the verb declares [draft_edit, draft_restore, relay_steer, board_row] as writers and this page gates [draft_edit, draft_restore, relay_steer]. The schemas in src/talk/talkToolSchemas.ts and site/lib/talkTools.ts have drifted.",
    );
  });

  it("refuses a name only one side has", () => {
    expect(refuseOnToolDrift({ declared: ["a"], declaredWriters: [], runnable: ["b"], runnableWriters: [] })).toContain(
      "the model would be told about a, which this page cannot run",
    );
  });
});
