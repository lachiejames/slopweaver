# The voice reads a Slack thread through the door, and opens it only to show the owner

Asked to read a thread, the voice must read it itself with the Slopweaver thread tools, never open it in the owner's
browser, read only what came after one message, and reach for the browser again. The owner corrected exactly that.

## The rule

- **READ** a thread ("read the thread", "read the full thread", "catch me up on it", "what's the latest on it", "is
  there a contribution to make"): `slack_open` with any message link in it — off the owner's screen, a card, a row, or
  a link a tool already used — and the answer comes from what it says.
- **SEE** it ("pull it up", "show me", "open it"): `browser_open`, which opens it in the owner's Slack desktop app with
  no browser tab. It reads nothing.
- **What came after one message** ("any replies after this", "did anyone answer"): `slack_thread_after`, which reads
  only what follows that message.
- **A whole channel** ("read this channel"): `slack_channel`, by the name on the owner's screen
  ([the channel rule](voice-reads-the-channel-on-the-owners-screen.md)).

## A thread is put in front of the owner once per call, and a read of another one says so

The voice must not keep opening the same Slack thread again, nor speak about a thread other than the one it put on
the owner's screen. Measured off a call's file: `open_card` put the card's thread up, two more `browser` looks
followed within a minute across two of the owner's turns, and the card linked two threads in different channels, so
the voice spoke about the one the owner was not looking at. Two of the owner's turns apart is why the record is per
CALL, not per turn. `browser` refuses a Slack message link, so a repeat reaches `browser_open` or `open_card`.

- `site/lib/slackThreadsShown.ts` (pure) keeps the threads opened this call, keyed by workspace, channel and root
  `ts` from `threadKeyOf`, so a reply's link and the root's are one thread. The last entry is what is on the owner's screen.
- `site/components/voice/slackScreenVerb.ts` wraps the one verb seam every opening reaches: the model's
  `browser_open`, `open_card`'s thread and `triage_next`. A `browser_open` of any thread this call already showed the owner,
  the last one or one since covered (still open in the owner's Slack app), opens nothing and answers `alreadyOnOwnerScreen: true` with
  why; `open_card` names that opening `skipped`, never a toast. Two overlapping opens of one thread open it once. A
  `slack_open` of any thread but the last one shown runs, and its answer carries `notOnOwnerScreen` naming that one.
- The record is fresh for each call the owner starts and kept across a reconnect or rollover: the provider holds one
  guarded seam for its life (`slackScreenForCall`, through `useOpenCardSeams`).

Not covered: a thread the owner opened personally in Slack, and the voice talking from card text (`read_card`) about a
thread other than the one on screen; only `slack_open` is annotated. A thread the owner has since navigated away from in Slack answers already open; the owner
asks to see it again and the voice says it is up. A bare reply permalink with no `thread_ts` names its own `ts`, not
its root's, so it reads as another thread: telling them apart takes a Slack read the opening does not make. Slack's
own copied reply links carry `thread_ts`.

## Why it went to the browser

Nothing told the delegated thread that a thread could be read whole from a link it already had. `slack_open` was
described as the second step after `slack_unread` only, called only once the owner named a row, the one Slack route in
the backend prompt was `slack_thread_after` (a suffix read), a card's thread was read by `slack_thread_after`, the
typed prompt sent a pasted link there too, and "pull up" mapped to `browser_open` while `browser` listed Slack among
its pages. So "pull up the full thread" got the browser plus a suffix read, and "read the thread" had no route at
all but the browser and the suffix read.

## Where the rule lives

- `src/talk/sessionConfig.ts`: one READ / SEE line before the after-one-message line; `browser` is never a Slack
  thread; a card's thread is read whole by `slack_open`.
- `src/talk/slackToolSchemas.ts`: `slack_open` is the thread read from any message link, and it, not
  `slack_thread_after`, stands in for `slack read-thread` in the reach inventory.
- `src/talk/cardToolSchemas.ts`, `src/talk/talkSurface.ts`, `src/talk/seatToolSchemas.ts`: the card read, the typed
  prompt, the `browser` tool and `browser_open` (which reads nothing) say the same.
- `src/talk/continuityReading.ts`: after a rollover, a Slack thread the last call was reading is opened again with
  `slack_open`, whatever opened it then, so a suffix read is never carried forward as the way back in.
- `site/lib/talkTools.ts`: the `browser` tool REFUSES a Slack message link, naming `slack_open`, so the prompt is not
  the only thing holding the line. `browser_open` shows one, and a Slack page that is not a message link (a
  canvas, a file) has only the browser.
- `src/talk/slackRouteCases.ts`: synthetic eval cases for the thread asks, each with the tool it must reach for first,
  held to the prompt by `unit/talk/slackRouting.test.ts`. A substring proves the prompt names a route; which tool
  the model picks is the replay below.

## The replay

The owner's four turns from the call behind the correction, through the real delegated thread — `talk offer`'s own app-server argv and
`thread/start`, one text `turn/start` each, every verb tool answered by the real verb against the owner's real Slack.
The card the call was on was the context: the first turn carried one line saying it was open, and `read_card`
answered with its row, whose text holds the thread's link. The browser tools were never run (a replay does not drive
the owner's Chrome): they answered the refusal the call itself got, and in the After runs the `browser` look met the guard.
Before is the build on `main` without the rule; After carries the rule above. First Slack-thread tool per turn:

| The owner's turn                          | Want           | Before, alone (2 runs)               | After, alone (2 runs) | Before, in order (2 runs)                             | After, in order (2 runs)                                      |
| ----------------------------------------- | -------------- | ------------------------------------ | --------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| pull up the full thread                   | `browser_open` | `browser_open`, `slack_thread_after` | `browser_open` ×2     | `slack_thread_after`, `browser_open`                  | `browser_open` ×2                                             |
| was the full thread read through the API  | `slack_open`   | `slack_thread_after` ×2              | `slack_open` ×2       | none (answered from the suffix), `slack_thread_after` | `slack_open` ×2                                               |
| is there a contribution worth making      | `slack_open`   | `slack_thread_after` ×2              | `slack_open` ×2       | none ×2 (answered from the suffix)                    | none ×2 (answered from the whole thread read the turn before) |
| read the thread with the Slopweaver tools | `slack_open`   | `slack_thread_after` ×2              | `slack_open` ×2       | `slack_thread_after` ×2                               | `slack_open` ×2                                               |

Before, `slack_open` was called **0 times in 16 turns**. After, **16 of 16** turns went where they should: both
show turns to `browser_open` each time, and every read turn to `slack_open` (10 of 10 that called a tool; the two
that did not answered from the whole thread read the turn before), each answer naming the whole thread ("all
fifty-three replies"). Never once, before or after, did a
read turn call `browser`; the call's own `browser` look is what the guard refuses outright.

## Still open

- **The live check with the owner.** The replay is the owner's words over text turns, not the realtime voice handing a
  turn off on a call the owner is on.
