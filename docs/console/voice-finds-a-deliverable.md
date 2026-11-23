# "Where is the briefing" — the voice reads every place a session ends in

Part of [The voice's context pack](voice-context-and-calls.md).

The voice never tells the owner a briefing does not exist when it simply could not find one: that has been wrong
many times over, and the briefing always turned out to exist.

In one call the owner had asked for the Tauri briefing. It existed in two places:

- the Tauri run's plan file, `~/dev/acme-desktop-tauri/PLAN.md`;
- that run's Queue card, whose recorded question ended:
  `Folder: ~/dev/acme-desktop-tauri … Plan: PLAN.md in the folder.`

No page was published for it until after the call ended. The voice:

- opened on "The briefing's now ready" before any read;
- read `PLAN.md`, judged it short of the archive-code and Vanta deep dive, and called the claim "not backed by
  anything complete";
- on the next turn read the card, the published index and the handover doc, which names no file, and said "The
  implementation plan's there, but not the full briefing yet".

The deliverable sat in a card's words and in a file those words named. Nothing handed the voice that file as
something to read: `board_row` read the doc and never the run's journal, and a card's `links` carried only published
pages and `https://` addresses.

## What the voice reads now

A briefing, plan, proposal, report, page or draft ends in one of four places, and the backend prompt names all four
(`src/talk/deliverableFindLines.ts`):

1. a published page — `page find`;
2. a Queue card — `action_items` or `talk find-card`, then `read_card`;
3. its run's journal — `board_row`'s `question`, which is the question the card holds open (`questionHeld: true`)
   or, once answered, the last one it recorded (`questionHeld: false`). An unreadable journal comes back as
   `journalUnread`, never as a run that asked nothing;
4. every local file either names — `read_card`'s `links.files` and `board_row`'s `files`, each read with `file_read`.

`files` is read off the card's words, the whole of its `what` below the fold included (`site/lib/cardFiles.ts`), and off the row's summary, body and journal question
(`src/talk/namedFiles.ts`). It takes `~/` paths, absolute paths under a machine root (so `GET /v1/people/{id}` is not
a file), and a bare document name such as `PLAN.md` joined to the one folder the same text names. A path inside an
address is never taken. Existence is never checked: `file_read` answers that, and a failed read is named as failed.

The rules on top of the reads:

- **No published page is a missing publication, never a missing deliverable.**
- **A found one is placed, then read.** One sentence says where it is, then `file_read`, following `nextFrom` or the
  outline before saying what the whole of it covers.
- **What it covers is its contents.** "The plan covers X and doesn't go into Y yet", never "that isn't the briefing"
  or "not the full briefing yet".
- **Nothing is ready unless a read this turn found it**, and the voice never upgrades or demotes one on its own.

The `talk find-card` stop rule, "end the turn; never search files", is scoped to finding a card. A deliverable search
goes on to the files a card or row names.

## What it does not cover

- `talk find-card` searches the question a card holds OPEN, not every question a run ever recorded. A deliverable
  whose run was answered and whose row left the board is found only by its slug, through `board_row`.
- A folder named on its own, with no document name beside it, is not a file and is not in `files`. Measured on the
  Tauri row itself: its later correction names `~/dev/acme-desktop-tauri` and a published page, so `files` is
  empty and the page is found by `page find`.
- The parser is syntactic: a path with spaces, a folder name with a dot, or a document without one of the listed
  extensions is not taken.
- The prompt tests prove the lines are wired, not that the model obeys them.
