/**
 * A committed fixture: thirty written synthetic lines in the seven shapes the console voice's unasked speech took on
 * the calls this fixture covers (the voice says things the owner never asked about, then cannot say
 * where they came from), each with a line of the owner's before it. `site/__tests__/unit/unpromptedVoiceReplay.test.ts`
 * replays each through the page's shape that replaced its source, `src/__tests__/unit/talk/unpromptedVoicePrompts.test.ts`
 * through the prompts and the opener — split so the site build never type-checks the prompts' import tree.
 *
 * Every word, call key and instant here is written, not transcribed, about invented work (a docs migration, a release
 * week, a build cache): the seven source counts are those the calls held, and each string is shaped for the shipped
 * function that reads it. A count false positive is built to land on one of the count reader's exclusions; a
 * board-only relay's line of the owner's is short or past the opener's clip, in the same pattern as before; a side remark
 * opens on its cue; an invented question ends on one, three of them announcing the count the retired prompt line
 * asked for.
 */

/** Where an unasked line came from. A closed set. */
export type UnpromptedVoiceSource =
  /** The page caught a count the app did not show, and the correction it handed back was said as a bare figure. */
  | "count-correction"
  /** A relay's delivery was narrated unasked: on the board but not the supervisor's chat, or a correction of that. */
  | "board-only-relay"
  /** Asked where its own line came from, the call said it did not know. */
  | "no-record"
  /** An aside opening on a cue, beside what the owner was saying. */
  | "side-remark"
  /** A question of its own: the thinking model's answer that turn carried none. */
  | "invented-question"
  /** A sentence the page's count reader read as a count of the owner's Queue when it was not one. */
  | "count-false-positive"
  /** A claim nothing on the call supported: a send, a pull request number, a copy-tray item. */
  | "realtime-invention";

/** One unasked line, in the shape a call file records it. */
export interface UnpromptedVoiceLine {
  /** A call key: eight characters, in the place of a call id's first eight hex characters. */
  readonly call: string;
  /** The voice segment's instant. */
  readonly at: string;
  /** The voice segment's text, without surrounding whitespace. */
  readonly voiceWords: string;
  /** The owner's line before it on the same call, without surrounding whitespace; "" when there is none. */
  readonly hisWords: string;
  readonly source: UnpromptedVoiceSource;
}

/** The lines, grouped by source, each group oldest first. */
export const UNPROMPTED_VOICE_LINES_18_TO_19_OCT: readonly UnpromptedVoiceLine[] = [
  {
    at: "2026-10-19T00:41:12.310Z",
    call: "c0000001",
    hisWords:
      "So the build page lists the stages in order, with the logs underneath each one. I think the second stage is the one that failed, if you have a look here",
    source: "count-correction",
    voiceWords: "Everything's forty-one.",
  },
  {
    at: "2026-10-19T00:41:15.902Z",
    call: "c0000001",
    hisWords: "Right",
    source: "count-correction",
    voiceWords: "Everything's forty-one.",
  },
  {
    at: "2026-10-19T09:52:40.118Z",
    call: "c0000002",
    hisWords: "Hm",
    source: "count-correction",
    voiceWords: "Everything shows fifty-seven right now.",
  },
  {
    at: "2026-10-19T13:20:07.455Z",
    call: "c0000003",
    hisWords: "Which of the release tasks are still open before Thursday, and who has each of them",
    source: "count-correction",
    voiceWords: "Everything's at sixty-two right now.",
  },
  {
    at: "2026-10-19T13:20:11.730Z",
    call: "c0000003",
    hisWords: "Which of the release tasks are still open before Thursday, and who has each of them",
    source: "count-correction",
    voiceWords: "Everything's at sixty-two right now.",
  },
  {
    at: "2026-10-19T02:14:03.201Z",
    call: "c0000004",
    hisWords: "Yes, the nightly job posts its summary to the team room and only pages someone when it fails twice",
    source: "board-only-relay",
    voiceWords:
      "Heads up: that steer is on the board, but it didn't reach the supervisor chat. Keep going with it here, or pause until it does?",
  },
  {
    at: "2026-10-19T02:14:37.660Z",
    call: "c0000004",
    hisWords:
      "Hold on, is the supervisor up? Let me look. The last few relays seem to have gone through from here, so I am not sure what happened",
    source: "board-only-relay",
    voiceWords:
      "Heads up: that steer is on the board, but it didn't reach the supervisor chat. Keep going with it here, or pause until it does?",
  },
  {
    at: "2026-10-19T02:33:19.045Z",
    call: "c0000004",
    hisWords:
      "The docs migration needs a decision on where the old pages redirect. Most of them map one to one, but the reference section was split last year, so some of those pages have two possible homes and a few have none. I would rather we pick a rule now, write it down beside the redirect table, and apply it across the whole section than decide page by page as the reviews come in",
    source: "board-only-relay",
    voiceWords: "Heads up: that steer is on the board, but",
  },
  {
    at: "2026-10-19T05:08:22.517Z",
    call: "c0000005",
    hisWords: "Yeah",
    source: "board-only-relay",
    voiceWords: "Heads up, that steer didn't reach the supervisor chat. Which comes first?",
  },
  {
    at: "2026-10-19T09:31:05.880Z",
    call: "c0000002",
    hisWords:
      "For the demo next week I want three things on one screen: the new sign-up flow, the before and after load times, and the list of open bugs we are choosing to ship with. Keep the script short. Each part should take a couple of minutes at most, and anything we cannot show live should be a short clip instead of a slide. If the load-time numbers are not ready by Tuesday, leave that part out rather than show estimates, and tell me early so I can rework the order. Questions from the audience go at the end, not in the middle",
    source: "board-only-relay",
    voiceWords: "Heads up: that steer’s on the board, but it didn’t reach the supervisor chat.",
  },
  {
    at: "2026-10-19T09:49:48.312Z",
    call: "c0000002",
    hisWords:
      "On the build cache, I think we stop trying to make the shared cache perfect and just make a miss cheap. Keep the cache, but when a key is stale the job should rebuild that one package and move on instead of failing the whole pipeline. Then add a weekly report of how often that happens, so we can see whether the cache is earning its keep or just adding moving parts",
    source: "board-only-relay",
    voiceWords: "Heads up: that steer’s on the board, but it didn’t reach the supervisor chat.",
  },
  {
    at: "2026-10-19T09:54:26.074Z",
    call: "c0000002",
    hisWords:
      "Good point. The on-call rota should cover the release week first, then the two weeks after. Put the people who built the feature on the first shifts, because they will know where to look, and keep the later shifts for whoever has not been on call this quarter. If nobody volunteers for a slot by Friday, leave it empty and tell me",
    source: "board-only-relay",
    voiceWords: "Heads up: that steer’s on the board, but it didn’t reach supervisor chat.",
  },
  {
    at: "2026-10-19T10:06:11.590Z",
    call: "c0000002",
    hisWords:
      "The changelog keeps drifting from what actually shipped. Every release somebody writes it from memory a day later, and it misses half the fixes. Can we generate the first draft from the merged changes, grouped by area, and then have a person edit it down? I do not want a wall of change titles, just a draft good enough that editing it is faster than starting from a blank page, with the fixes people will notice at the top and the internal ones folded away underneath",
    source: "board-only-relay",
    voiceWords: "Heads up: that steer’s on the board, but it didn’t reach the supervisor chat.",
  },
  {
    at: "2026-10-19T21:40:33.427Z",
    call: "c0000006",
    hisWords: "Hm",
    source: "board-only-relay",
    voiceWords: "board, but it didn't reach the supervisor chat. Go on.",
  },
  {
    at: "2026-10-19T21:41:58.903Z",
    call: "c0000006",
    hisWords:
      "Actually, it is fine as it is. The release note reads well and the screenshots are the right ones, so let us leave it there and move on to the next item on the list. Oh, wait, what",
    source: "board-only-relay",
    voiceWords: "Quick correction: Your instruction did reach the supervisor chat. That confirms receipt, not closure.",
  },
  {
    at: "2026-10-18T22:38:51.660Z",
    call: "c0000007",
    hisWords: "That is not PR one two three. That number sounds made up, and I don't know where it came from",
    source: "no-record",
    voiceWords:
      "It's PR forty-five thousand six hundred seventy-eight from the thread. I don't know why one two three was added.",
  },
  {
    at: "2026-10-19T00:41:34.208Z",
    call: "c0000001",
    hisWords: "Wait, what does everything's forty-one mean",
    source: "no-record",
    voiceWords:
      "Looking. Nothing I wrote says forty-one, and it isn't about the build stages; I can't tell yet where it came from.",
  },
  {
    at: "2026-10-19T09:53:09.741Z",
    call: "c0000002",
    hisWords: "Where'd that come from",
    source: "no-record",
    voiceWords:
      "That figure isn’t in anything I wrote: “Everything shows fifty-seven right now” was the voice on its own. On the redirects, one rule for the split pages, or each page in review?",
  },
  {
    at: "2026-10-19T01:02:47.315Z",
    call: "c0000008",
    hisWords:
      "Can you pull together the history of the docs migration from the planning thread? Start from the first proposal, list the decisions in order, and mark which ones are still open. Then help me get a short summary in the copy tray that I can post as the opening message of the review thread",
    source: "side-remark",
    voiceWords:
      "Side note, the redirect table you opened earlier still has unsaved edits. Save them first, or carry on with the summary?",
  },
  {
    at: "2026-10-19T21:40:21.088Z",
    call: "c0000006",
    hisWords:
      "Cool. Next I am going to look at the open release tasks. The first one has the right reviewers and its description names the risk up front, which is what I want to see",
    source: "side-remark",
    voiceWords: "Side note—the",
  },
  {
    at: "2026-10-19T09:45:30.512Z",
    call: "c0000002",
    hisWords:
      "Picture the release week going well: the notes are drafted, the rota is filled, the demo runs on time and nothing pages anyone overnight. That is the week I want to plan for, so tell me what has to be true by Monday for it to happen",
    source: "invented-question",
    voiceWords:
      "For that week, Monday needs a frozen branch, a filled rota and a finished demo script. Two quick ones on that first. Say a fix lands after the freeze; do we take it into the release or hold it for the next one? And when the demo and a fix compete for the same afternoon, which goes first?",
  },
  {
    at: "2026-10-19T09:49:02.247Z",
    call: "c0000002",
    hisWords:
      "Hold it for the next one unless it is a security fix. And the demo goes first, because its date is fixed and a fix can land the morning after",
    source: "invented-question",
    voiceWords:
      "Understood: only security fixes cross the freeze, and the demo keeps its slot. Two quick ones on that first. Say a security fix needs a reviewer who is on leave; wait for them or take the next person on the rota? And should the changelog name it, or stay general until it ships?",
  },
  {
    at: "2026-10-19T09:50:13.389Z",
    call: "c0000002",
    hisWords:
      "Take the next person on the rota. The changelog can say a security fix shipped, with no detail, until it is out",
    source: "invented-question",
    voiceWords:
      "That works. The rota picks the reviewer and the changelog stays general. Two quick ones on that first, though. Say the rota slot is empty that day. Does the fix wait, or come to you?",
  },
  {
    at: "2026-10-19T10:06:04.822Z",
    call: "c0000002",
    hisWords:
      "If it is empty, it comes to me. I would rather know than have it wait quietly, and I can find someone faster than the rota can",
    source: "invented-question",
    voiceWords:
      "Then an empty rota slot becomes a card for you, not a quiet wait. Two questions on that first: say the slot empties after the card exists; should it update that card or raise a new one? And should I read the open cards at call start, or only when you ask?",
  },
  {
    at: "2026-10-19T00:41:10.477Z",
    call: "c0000001",
    hisWords:
      "So the build page lists the stages in order, with the logs underneath each one. I think the second stage is the one that failed, if you have a look here",
    source: "count-false-positive",
    voiceWords: "Right, the 'Test' stage is red, and that's the one it asks for.",
  },
  {
    at: "2026-10-19T09:52:33.009Z",
    call: "c0000002",
    hisWords:
      "I think anything blocked on a decision blocks the whole task, but give me a concrete example so I know we mean the same thing",
    source: "count-false-positive",
    voiceWords:
      "Say one card lists three broken links, and one of them points at a deleted page; fix the two live links now and park the third, or hold the card until all three are sorted?",
  },
  {
    at: "2026-10-19T13:20:03.264Z",
    call: "c0000003",
    hisWords: "Which of the release tasks are still open before Thursday, and who has each of them",
    source: "count-false-positive",
    voiceWords:
      "The redirect rule comes first on Thursday, then the rota. I can’t list ten specific cards from here; the last queue read is stale.",
  },
  {
    at: "2026-10-18T22:38:20.143Z",
    call: "c0000007",
    hisWords: "All right, not now on this note. I'm going to review a PR Rowan just tagged me in, if you want to watch",
    source: "realtime-invention",
    voiceWords:
      "That's PR one two three on your screen, the config loader rename; the migration note lands in a later change.",
  },
  {
    at: "2026-10-19T00:58:31.906Z",
    call: "c0000001",
    hisWords: "Good, I've sent that one myself. Let's get back to the list. Where were we",
    source: "realtime-invention",
    voiceWords: "Draft sent.",
  },
  {
    at: "2026-10-19T21:43:47.215Z",
    call: "c0000006",
    hisWords: "I just saw an error when you tried that. Take a screenshot and file a bug with the supervisor",
    source: "realtime-invention",
    voiceWords:
      "I've saved a screenshot of the error and a draft bug report for the supervisor; both are in your copy tray. Want me to send it?",
  },
];
