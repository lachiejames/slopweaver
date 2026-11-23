/**
 * Synthetic evaluation cases for how the console voice routes a Slack ask, each with the Slack tool it must reach
 * for: READ meaning the door's read, SEE meaning the browser, and "this channel" meaning the one on the owner's
 * screen.
 *
 * The first call's cases point at the owner's screen: asked to read "this channel", the voice names the channel the
 * screen shows and reads it with the live channel read, never asking for an id.
 *
 * The second call's cases separate SEE from READ on one thread: "pull it up" opens it in the browser, while reading
 * the full thread, judging whether there is a contribution to make, and a correction to stop opening it in the
 * browser all go through the Slopweaver thread read.
 *
 * Pure data. `unit/talk/slackRouting.test.ts` holds the backend prompt to naming each case's class and tool; which
 * tool the model actually picks is a replay's to show, never a substring's (`docs/console/voice-reads-a-slack-thread.md`).
 */

/** The Slack tools a case may expect. */
type TalkSlackExpectedTool = "browser_open" | "slack_channel" | "slack_open" | "slack_thread_after";

/** One evaluation case and what it must reach for. */
export interface TalkSlackRouteCase {
  /** The call the case belongs to, shaped as the id of a file under `talk/calls/`. */
  readonly call: string;
  /** The turn's id in the call file, `talk-call:<call>#<id>`. */
  readonly id: string;
  /** What the owner says, as a call would transcribe it. */
  readonly utterance: string;
  /** Whether the ask names something only the owner's screen shows, so `read_screen` comes before the Slack tool. */
  readonly looksFirst: boolean;
  /** The Slack tool the voice must call for it, first of the Slack tools. */
  readonly expectedFirstTool: TalkSlackExpectedTool;
  /** The short phrases of the ask's class the backend prompt must route, verbatim. */
  readonly promptAnchors: readonly string[];
}

/** The cases, call by call, in conversation order. */
export const TALK_SLACK_ROUTE_CASES: readonly TalkSlackRouteCase[] = [
  {
    call: "aaaaaaaa-0000-4000-8000-000000000001",
    expectedFirstTool: "slack_channel",
    id: "turn_000000000000000000001",
    looksFirst: true,
    promptAnchors: [
      "'read this channel'",
      "Never ask for an id.",
      "'This channel', 'this thread', 'this PR', 'read this'",
    ],
    utterance:
      "Can you read this channel for me? It is open on my screen, so use the one you can see there rather than " +
      "asking me for its id.",
  },
  {
    call: "aaaaaaaa-0000-4000-8000-000000000001",
    expectedFirstTool: "slack_channel",
    id: "turn_000000000000000000002",
    looksFirst: true,
    promptAnchors: ["'read this Slack channel'", "'This channel', 'this thread', 'this PR', 'read this'"],
    utterance:
      "When I say read this Slack channel, look at my screen, tell me which channel you can see, then get its " +
      "whole history and summarise it back to me.",
  },
  {
    call: "bbbbbbbb-0000-4000-8000-000000000002",
    expectedFirstTool: "browser_open",
    id: "turn_000000000000000000015",
    looksFirst: false,
    promptAnchors: ["'pull it up'"],
    utterance: "Separate thing. I am catching up on a long thread. Can you pull it up so I can see the whole thing?",
  },
  {
    call: "bbbbbbbb-0000-4000-8000-000000000002",
    expectedFirstTool: "slack_open",
    id: "turn_000000000000000000016",
    looksFirst: false,
    promptAnchors: ["'read the full thread'"],
    utterance:
      "Did you read the full thread through the API? It started as a request for a review and has turned into a " +
      "discussion about making reviews quicker.",
  },
  {
    call: "bbbbbbbb-0000-4000-8000-000000000002",
    expectedFirstTool: "slack_open",
    id: "turn_000000000000000000017",
    looksFirst: false,
    promptAnchors: ["'is there a contribution to make'"],
    utterance:
      "We already have work going on in that area. Is there a worthwhile contribution to make to the thread before " +
      "I move on?",
  },
  {
    call: "bbbbbbbb-0000-4000-8000-000000000002",
    expectedFirstTool: "slack_open",
    id: "turn_000000000000000000018",
    looksFirst: false,
    promptAnchors: ["'read the thread'", "never browser or browser_open to read one"],
    utterance:
      "No, you need to read the thread yourself. Stop opening it in the browser and use the Slopweaver tools for " +
      "reading threads.",
  },
];
