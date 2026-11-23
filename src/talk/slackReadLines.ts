/**
 * The thinking model's Slack-reading bullets (`./sessionConfig.ts`): a thread read whole through `slack_open`, what
 * came after one message through `slack_thread_after`, a channel's latest through `slack_channel`, and the owner's unread
 * through `slack_unread` — never a browser to read one. A link the owner types or pastes into the console mid-call is
 * the first of these: a pasted Slack thread link with no way to send it.
 *
 * The channel line replaced one sending a whole channel to `store query --channel <its id from the owner's screen>`: on
 * a real call the channel was not in the store, the voice could not read it live, and the owner ruled that "read this
 * Slack channel" means looking at their screen, not wrangling ids.
 *
 * The bound on threads and the never-relay are MEASURED: replaying the owner's two turns through the voice surface
 * (four runs), every channel turn called `slack_channel` first, but on "the whole channel" two runs opened the
 * threads one by one (19 and 18 `slack_open`s at 3–6 s each, the turn unfinished at 240 s) and two relayed a "read the
 * full channel" steer to the fleet, twice each. Repro: the replay in `docs/console/voice-reads-the-channel-on-the-owners-screen.md`.
 */

/** How the thinking model reads Slack: a thread, what followed a message, and the owner's unread. */
export const SLACK_READ_BACKEND_LINES: readonly string[] = [
  "- READ a Slack thread — 'read the thread', 'read the full thread', 'catch me up on it', 'what's the latest on",
  "  it', 'is there a contribution to make': slack_open with its message link (off the screen, a card, a row, or",
  "  a link a tool already used), then answer from what it says. Reading is yours, through the slopweaver tools;",
  "  never browser or browser_open to read one. SEE it — 'pull it up', 'show me', 'open it': browser_open.",
  "  Every message comes back whole unless the answer's cut names it; then say whose, and when, was cut",
  "  short. Never relay_steer a Slack read or offer a fleet session to finish one.",
  "  A Slack message link the owner typed or pasted into the console during the call, with no other ask, is that READ.",
  "  The Slack app shows no link: slack_channel the channel in the frame, find the thread's opening message by",
  "  its words in what comes back, and slack_open that message's link. Not there: say so, then ask the owner to",
  "  copy the message link — never compose one.",
  "- 'Any replies after this', 'did anyone answer' after one message: slack_thread_after with the message link,",
  "  which reads only what came after it, live; the corpus runs hours behind. No link",
  "  visible: find the message through slack_channel as for a thread; not there, ask",
  "  the owner to copy the message link, never compose one.",
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
  "- 'What's in my Slack', 'any unread DMs', 'what did I miss': slack_unread, read live, no screen needed. Say it",
  "  as a short list, DMs first, one line a row: who, where, and whether it asks the owner. Never read a thread",
  "  unasked; named one ('the ISO thread with Rosa'), slack_open with that row's url, then say what it is and",
  "  what, if anything, it wants from the owner. An activity row means a person spoke after the owner, never that",
  "  the owner has not seen it.",
];
