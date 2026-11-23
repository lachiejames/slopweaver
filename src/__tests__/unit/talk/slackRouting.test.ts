/**
 * The eval examples: READ a Slack thread is `slack_open`, SEE it is `browser_open`;
 * and "read this Slack channel" is the one on the owner's screen, read by `slack_channel`.
 * These hold the prompt to NAMING each case's class and tool; which tool the model actually picks is the replay's
 * (`docs/console/voice-reads-a-slack-thread.md`), never a substring's.
 */
import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { TALK_SLACK_ROUTE_CASES } from "../../../talk/slackRouteCases.js";
import { TALK_TYPED_INSTRUCTIONS } from "../../../talk/talkSurface.js";
import { TALK_TOOLS } from "../../../talk/talkToolSchemas.js";
import { ownerNeutral } from "./ownerNeutral.js";

/**
 * Every "ask [the owner] for a/an/the/its id, link or number" in a prompt, with the word before it when one stands
 * there. The object is optional so the subjectless "never ask for an id" is caught as surely as a named one.
 */
function asksOwnerFor({ prompt }: { prompt: string }): readonly string[] {
  // The word before is optional so a sentence opening "Ask the owner for an id" is caught too.
  const asks =
    /(?:[\p{L}']+\s+)?\bask\s+(?:(?:him|them|the\s+owner)\s+)?for\s+(?:an?\s+|the\s+|its\s+)?(?:\p{L}+'s\s+)?(?:channel\s+|message\s+|thread\s+)?(?:id|link|number)\b/giu;
  return Array.from(prompt.matchAll(asks), (match) => match[0]);
}

/** Every sentence of a prompt that has the owner copy or paste a link or URL, whitespace collapsed, in prompt order. */
function linkAsks({ prompt }: { prompt: string }): readonly string[] {
  return prompt
    .split(/\n-\s/u)
    .flatMap((bullet) => bullet.replaceAll(/\s+/gu, " ").split(/(?<=[.!?])\s/u))
    .filter((sentence) => /\b(?:copy|paste)/iu.test(sentence) && /\b(?:link|url)\b/iu.test(sentence));
}

/** The one backend-prompt bullet that opens with these words, whole, without its leading "- ". */
function bulletOpening({ opening }: { opening: string }): readonly string[] {
  return TALK_BACKEND_INSTRUCTIONS.split("\n- ").filter((bullet) => bullet.startsWith(opening));
}

describe("TALK_SLACK_ROUTE_CASES", () => {
  it("carries six cases on two calls, each once, in conversation order", () => {
    expect(TALK_SLACK_ROUTE_CASES.length).toBeGreaterThan(0);
    expect(TALK_SLACK_ROUTE_CASES.map((c) => [c.call.slice(0, 8), c.id, c.looksFirst, c.expectedFirstTool])).toEqual([
      ["aaaaaaaa", "turn_000000000000000000001", true, "slack_channel"],
      ["aaaaaaaa", "turn_000000000000000000002", true, "slack_channel"],
      ["bbbbbbbb", "turn_000000000000000000015", false, "browser_open"],
      ["bbbbbbbb", "turn_000000000000000000016", false, "slack_open"],
      ["bbbbbbbb", "turn_000000000000000000017", false, "slack_open"],
      ["bbbbbbbb", "turn_000000000000000000018", false, "slack_open"],
    ]);
    expect(new Set(TALK_SLACK_ROUTE_CASES.map((c) => c.id)).size).toBe(TALK_SLACK_ROUTE_CASES.length);
  });

  it("routes every case that points at the owner's screen, and no other, through the look-first line", () => {
    const lookFirst = "'This channel', 'this thread', 'this PR', 'read this'";
    expect(
      TALK_SLACK_ROUTE_CASES.map((c) => [
        c.id,
        /\bscreen\b/iu.test(c.utterance),
        c.looksFirst,
        c.promptAnchors.includes(lookFirst),
      ]).filter(([, screen, looks, anchored]) => screen !== looks || looks !== anchored),
    ).toEqual([]);
    expect(TALK_SLACK_ROUTE_CASES.filter((c) => c.looksFirst).map((c) => c.id)).toEqual([
      "turn_000000000000000000001",
      "turn_000000000000000000002",
    ]);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(`${lookFirst}: the one in the frame. read_screen first`);
  });

  it("expects only tools the voice is given", () => {
    const names = new Set(TALK_TOOLS.map((tool) => tool.name));
    expect(TALK_SLACK_ROUTE_CASES.filter((c) => !names.has(c.expectedFirstTool))).toEqual([]);
  });

  it("has the backend prompt name every case's class and its tool", () => {
    const missing = TALK_SLACK_ROUTE_CASES.flatMap((c) =>
      [...c.promptAnchors, c.expectedFirstTool].filter((anchor) => !TALK_BACKEND_INSTRUCTIONS.includes(anchor)),
    );
    expect(missing).toEqual([]);
  });
});

describe("the Slack thread routes in the prompts", () => {
  it("routes a READ to slack_open and a SEE to browser_open, in one line", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "slack_open with its message link (off the screen, a card, a row, or\n  a link a tool already used)",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("SEE it — 'pull it up', 'show me', 'open it': browser_open.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "browser opens a page no verb reads, such as a Datadog dashboard — never a Slack thread, nor a\n  GitHub pull request, issue or discussion page: verb github read reads those without touching the browser\n  (a pull request's commit or checks view, which it does not carry, is still a browser look).",
    );
  });

  // The answering turn ran `browser inspect` on the PR the owner had on screen.
  it("reads a GitHub object through github read, and never opens again, to read or show, a page the frame shows", () => {
    const browser = TALK_TOOLS.find((tool) => tool.name === "browser")!;
    const show = TALK_TOOLS.find((tool) => tool.name === "browser_open")!;
    expect(show.description).toContain(
      "A page the owner's screen frame already shows, a GitHub pull request included, is up too: say so and never call this for it.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  'Show me' or 'pull up' one the frame already shows: it is up, so say so; browser_open is for one it does not.",
    );
    expect(browser.description).toContain(
      "Never a GitHub pull request, issue or discussion page: verb github read <url> --json reads it (add --files for a " +
        "pull request's changed files), one on the owner's screen is already in the frame, and this refuses one. A pull " +
        "request's commit or checks view, which that verb does not carry, is still a look.",
    );
    expect(browser.description).not.toContain("a pull request, a Datadog");
    // The voice reads only the summary, in its tool inventory.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "- browser: open one Datadog, Linear or other registered page no verb reads in the owner's Chrome, read it, and close " +
        "it — never a GitHub pull request, issue or discussion page, which verb github read reads",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A page already on the screen is read, never reopened: never offer to open or pull up what is being shown.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  A page already on the screen is READ, never reopened: no browser, browser_open or open_card for it, since",
    );
  });

  it("carries the whole-channel bullet word for word, and every 'ask for an id' in the prompt is a never", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      [
        "- READ a Slack channel — 'read this channel', 'read this Slack channel', 'what's going on in #squad-platform',",
        "  'catch me up on the channel': slack_channel with the channel as you found it — its name off the screen (the",
        "  Slack app shows it above the messages), a link, or an id a tool gave you. Never ask for an id. It reads",
        "  the newest 50 top-level messages live, with reply counts, not every reply: say how far back that reaches when",
        "  older messages exist, and slack_open one message's link for its thread. A DM reads by its link, not a name.",
        "  That one read answers 'the whole channel', 'the entire history', 'all of it': never slack_open its threads",
        "  one by one. Asked for the replies too, slack_open at most the three threads with the most replies, then",
        "  answer, naming the busiest you left and offering it. The read is yours: never relay_steer it to the fleet.",
        "  Older than that window: store query --source slack --channel <the id slack_channel returned>, the corpus,",
        "  saying how current it is.",
      ].join("\n"),
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toMatch(ownerNeutral({ phrase: "<its id from their screen>" }));
    // Whole, so a clause appended to the bullet fails; and no ask for an id anywhere else is anything but a "never".
    expect(bulletOpening({ opening: "READ a Slack channel" })).toEqual([
      [
        "READ a Slack channel — 'read this channel', 'read this Slack channel', 'what's going on in #squad-platform',",
        "  'catch me up on the channel': slack_channel with the channel as you found it — its name off the screen (the",
        "  Slack app shows it above the messages), a link, or an id a tool gave you. Never ask for an id. It reads",
        "  the newest 50 top-level messages live, with reply counts, not every reply: say how far back that reaches when",
        "  older messages exist, and slack_open one message's link for its thread. A DM reads by its link, not a name.",
        "  That one read answers 'the whole channel', 'the entire history', 'all of it': never slack_open its threads",
        "  one by one. Asked for the replies too, slack_open at most the three threads with the most replies, then",
        "  answer, naming the busiest you left and offering it. The read is yours: never relay_steer it to the fleet.",
        "  Older than that window: store query --source slack --channel <the id slack_channel returned>, the corpus,",
        "  saying how current it is.",
      ].join("\n"),
    ]);
    expect(asksOwnerFor({ prompt: TALK_BACKEND_INSTRUCTIONS }).map((ask) => ask.toLowerCase())).toEqual([
      "never ask for an id",
      "never ask for an id",
      "never ask for a page's link",
    ]);
    expect(
      asksOwnerFor({
        prompt:
          "- Ask the owner for an id before reading a channel. Never ask for a link. Ask for a page's link first.",
      }),
    ).toEqual(["Ask the owner for an id", "Never ask for a link", "Ask for a page's link"]);
  });

  it("carries, word for word, the passage that finds a thread the Slack app shows no link for through its channel", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      [
        "  The Slack app shows no link: slack_channel the channel in the frame, find the thread's opening message by",
        "  its words in what comes back, and slack_open that message's link. Not there: say so, then ask the owner to",
        "  copy the message link — never compose one.",
      ].join("\n"),
    );
    // Presence alone passes a prompt that ALSO says "ask for the link at once, skip slack_channel".
    // Exactly two "ask the owner to copy" stand in the whole prompt, and no "not|never|skip|without slack_channel"
    // does. A differently worded contradiction is out of reach of any pattern, so the title claims the
    // passage only.
    expect(TALK_BACKEND_INSTRUCTIONS.match(/ask\s+(?:(?:him|them|the\s+owner)\s+)?to\s+copy/gu)!.length).toBe(2);
    expect(
      TALK_BACKEND_INSTRUCTIONS.match(/(?:not|never|skip|without)\s+(?:call(?:ing)?\s+|using\s+)?slack_channel/giu),
    ).toBe(null);
  });

  it("pins every sentence that has the owner copy or paste a link, and each ask to copy one follows a slack_channel look", () => {
    const askToCopy = /ask\s+(?:(?:him|them|the\s+owner)\s+)?to\s+copy/u;
    const asking = TALK_BACKEND_INSTRUCTIONS.split("\n- ").filter((bullet) => askToCopy.test(bullet));
    expect(asking.length).toBe(2);
    expect(
      asking.filter((bullet) => {
        const looks = bullet.indexOf("slack_channel");
        return looks === -1 || looks > bullet.search(askToCopy);
      }),
    ).toEqual([]);
    // "request that the owner paste the message URL" evades the phrase above, so every sentence that has the owner
    // copy or paste a link or URL is listed whole. No pattern catches every wording (such as "request its message
    // address from the owner"); the title claims only what is pinned here.
    expect(linkAsks({ prompt: TALK_BACKEND_INSTRUCTIONS })).toEqual([
      "A Slack message link the owner typed or pasted into the console during the call, with no other ask, is that READ.",
      "Not there: say so, then ask the owner to copy the message link — never compose one.",
      "No link visible: find the message through slack_channel as for a thread; not there, ask the owner to copy the message link, never compose one.",
    ]);
    // The voice prompt is held to the same list, so a copy ask added there is seen too.
    expect(linkAsks({ prompt: TALK_VOICE_INSTRUCTIONS })).toEqual([]);
    expect(TALK_VOICE_INSTRUCTIONS.split("\n").filter((line) => askToCopy.test(line))).toEqual([]);
    expect(linkAsks({ prompt: "Before trying tools, request that the owner paste the message URL." })).toEqual([
      "Before trying tools, request that the owner paste the message URL.",
    ]);
  });

  it("carries the name-it-back-first passage word for word in both prompts, each 'ask for an id' a never", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      [
        "- 'This channel', 'this thread', 'this PR', 'read this': the one in the frame. read_screen first, unless the",
        "  console already put the screen into this turn. Your first sentence names it ('You're in #squad-platform'),",
        "  then read it: a channel with slack_channel and the name the frame shows, a thread as the Slack lines say, a",
        "  pull request with verb github read and the repository and number the frame shows. Never ask for an id,",
        "  a link or a number: the frame is where you find it, and when it shows none, say what it does show.",
      ].join("\n"),
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      [
        "'This channel', 'this thread', 'this PR' is the one on the screen: hand a look over, say which one you see",
        "('you're in team platform'), then have it read. Never ask for an id, a link or a number to find it.",
      ].join("\n"),
    );
    expect(bulletOpening({ opening: "'This channel', 'this thread'" })).toEqual([
      [
        "'This channel', 'this thread', 'this PR', 'read this': the one in the frame. read_screen first, unless the",
        "  console already put the screen into this turn. Your first sentence names it ('You're in #squad-platform'),",
        "  then read it: a channel with slack_channel and the name the frame shows, a thread as the Slack lines say, a",
        "  pull request with verb github read and the repository and number the frame shows. Never ask for an id,",
        "  a link or a number: the frame is where you find it, and when it shows none, say what it does show.",
        "  A page already on the screen is READ, never reopened: no browser, browser_open or open_card for it, since",
        "  each moves the windows on show. What github read leaves out, say from the frame or say is unread.",
        "  'Show me' or 'pull up' one the frame already shows: it is up, so say so; browser_open is for one it does not.",
      ].join("\n"),
    ]);
    // An "always ask for the channel id first" anywhere in either prompt contradicts the titled behaviour.
    expect(asksOwnerFor({ prompt: TALK_BACKEND_INSTRUCTIONS }).map((ask) => ask.toLowerCase())).toEqual([
      "never ask for an id",
      "never ask for an id",
      "never ask for a page's link",
    ]);
    expect(asksOwnerFor({ prompt: TALK_VOICE_INSTRUCTIONS }).map((ask) => ask.toLowerCase())).toEqual([
      "never ask for an id",
      "never ask for the link",
    ]);
  });

  it("keeps slack_thread_after to what came after one message", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "'did anyone answer' after one message: slack_thread_after with the message link,\n  which reads only what came after it",
    );
  });

  it("reads a card's thread whole", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("the whole thread by slack_open, any other page by browser");
    const readCard = TALK_TOOLS.find((tool) => tool.name === "read_card")!;
    expect(readCard.description).toContain("slack_open for the whole thread");
  });

  it("sends a pasted Slack link in a typed conversation to slack_open", () => {
    expect(TALK_TYPED_INSTRUCTIONS).toContain("a Slack message link goes to slack_open for the whole thread");
  });

  it("sends a Slack link the owner pasted into the box mid-call to slack_open, as the owner's turn", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A Slack message link the owner typed or pasted into the console during the call, with no other ask, is that READ.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("it reaches you as a user message\nand is their turn");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A Slack message link in it is a thread for\nthe thinking model to read whole with slack_open",
    );
  });

  it("tells the browser look it never takes a Slack message link", () => {
    const browser = TALK_TOOLS.find((tool) => tool.name === "browser")!;
    expect(browser.description).toContain(
      "Never a Slack message link: slack_open reads that thread, and this refuses one.",
    );
  });

  it("tells browser_open, which reads nothing, that a Slack thread it showed is read by slack_open", () => {
    const show = TALK_TOOLS.find((tool) => tool.name === "browser_open")!;
    expect(show.description).toContain("use browser or verb to read a page, and slack_open to read a Slack thread.");
  });

  // The owner does not want the same Slack thread opened over and over, nor a thread other than the one they asked
  // for — the two answer fields the page adds (`site/components/voice/slackScreenVerb.ts`).
  it("tells browser_open a thread already shown answers alreadyOnOwnerScreen, and slack_open what notOnOwnerScreen means", () => {
    const show = TALK_TOOLS.find((tool) => tool.name === "browser_open")!;
    const read = TALK_TOOLS.find((tool) => tool.name === "slack_open")!;
    expect(show.description).toContain(
      "A Slack thread already put in front of the owner in this call is never opened again: the answer is " +
        "alreadyOnOwnerScreen: true and nothing opened, so tell the owner it is up and walk them through it.",
    );
    expect(read.description).toContain(
      "When the answer carries notOnOwnerScreen, what you read is NOT the thread put in front of the owner this call",
    );
  });
});
