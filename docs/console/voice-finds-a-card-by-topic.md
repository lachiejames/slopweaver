# "Is there already a card for this" — the voice searches the whole board by topic

Part of [The voice's context pack](voice-context-and-calls.md).

At the computer the owner can look at the Queue and see that the thing being asked about is right there; on a call,
whether a card like that exists has to be something the voice can answer. In one call the owner asked whether there
was a card for giving the voice more capability. One existed, `the-console-voice-can-do-what-other-agents`, with a
run open on it. The voice said it could not find it, because `action_items` only draws the rows waiting on the owner's word
and the whole board was not on its read list.

`slopweaver talk find-card <words>...` is that read, on the voice's `verb` list (`src/talk/modelReads.ts`). The
backend prompt says how to use it (`src/talk/sessionConfig.ts`):

- Make ONE call per question, passing the owner's topic plus two or three other ways a card might say it.
- Name the on-topic row in one sentence by what it is about and where it stands, never by its slug.
- If no held draft and no row is about the topic, say so, name what was searched, and end the turn.
- A row it says is not on the owner's Queue, or not known to be, has no card to open: say where it stands, and never call
  `open_card` on it.

The same call also runs when finding a card without its key, before the voice says it could not find one. It comes after
`action_items` and a `read_card` on a key that list gives whose subject is about the owner's words, which only checks the guess,
so a wrong one never opens. The card it finds is opened before the voice says a word about it.

- **A held draft on the owner's Queue is searched too, and named first.** In one call the owner asked where the
  Linear briefing, or its queue card draft, was. The held DM to a colleague was on the owner's Queue as a `post:`
  card. The voice told the owner "The draft row points to a CrowdStrike card instead":
  - find-card ranked only board rows, and a held draft is a Queue card, not a row;
  - the closed row that raised the draft named a stale `post:` key in its summary;
  - `read_card` on that key returned the CrowdStrike card.

  Every draft the Queue draws as a `post:` card is now ranked over the rows and drafts together, in a pass of its
  own, so the rows keep the ranking they had and a draft never moves one out of the pools composed
  (`src/talk/queueDraftFind.ts`). A draft counts when it is held and not sent back for a finding's missing proof,
  the Queue's own criterion.
  A draft is searched on its `why`, its words, who it tags, where it goes and the summary of the row that raised it.
  The answer names up to three matching drafts above the rows by the key `open_card` takes, and counts the rest.
  Each line quotes how the message opens beside its `why`, because a recut can leave the `why` stale while the
  words the owner asked for sit below it, and the voice judges a draft by both. When the first word it matched
  lies past that opening, the line also quotes the message from just before that word. An
  unreadable register exits non-zero rather than answering "no draft". The prompt says a key written in a row's prose
  is where that row once pointed, never the card, and that the card open on the owner's screen is never the answer for being
  open. With the owner's exact words and with the voice's own (`Linear briefing draft three projects DM` and the
  colleague's name), over the register as it stood at the time of the ask, the first draft named is the held DM and the
  CrowdStrike draft is not named.

- **A newer page on the same topic is named as the one the owner asked for opens.** Later in the same call the owner asked to open
  a project's implementation briefing. `page find` ranked a newer page first, that day's working-group notes on what
  the meeting changed for the project. The voice searched again in words that dropped it, opened the older briefing, and never named the newer
  page. When the owner asked whether today's meeting had been read, it said it could not confirm, and it found the page
  only seven minutes later. The prompt says to name a same-topic page dated after the one opened, with its date,
  and never to search it away.

- **Matched on topic, never on the slug.** A row is scored on these fields:
  - its summary;
  - its problem;
  - the owner's words on it: the ruling, every section headed as the owner's word as `board_row` reads them
    (`boardRowOwnerWords`), and the
    quotes held under its anchor and steers;
  - its open question.

  A word matches at the start of a row's word, as in `page find` (`src/pages/findWords.ts`). The board's own filler
  list keeps "browser" and "screen", which name a row's topic.

- **Ranked by BM25, measured.** `page find`'s rarity sum, run over a 7,066-row board, gave this:
  - 64 rows tied at the top, every long supervisor handoff among them;
  - the voice-capability row was not in the first forty.

  BM25 damps a word that repeats and a row that is long, so a one-sentence row about the owner's words outranks a long one
  that only mentions them (`src/talk/cardFind.ts`).

- **The paraphrases are the part ranking cannot do.** The owner's own words do not place that row in the first 24 live rows:
  "capability" and "tools" are not words the row uses.
  - The owner's words: `voice more capability tools access agents verbs browser`.
  - The paraphrase set, which ranks it first: `voice other agents browser slopweaver verbs commands`.
- **Placed as `handover list` places it, in under the verb tool's sixteen seconds.** Composing the whole board took
  9.9s (`time slopweaver handover list --json | wc -c`). The verb therefore does this (`src/cli/commands/talk/findCardRun.ts`):
  - reads every doc and journal ONCE, 32 files open at a time (`scanBoardConcurrently`,
    `journalEvidenceConcurrently`), and finds the owner's words in a doc's body off the text the scan already holds. On this
    machine a board read costs per file OPENED, not per byte;
  - counts each row's words once, though it ranks the rows twice: alone, then beside the held drafts;
  - composes only the best 24 live and 6 closed matches, plus every row their `blockedBy` reaches. Without those
    blockers, a match waiting on another row would read as ready.
  - runs only declarative probes, under 8 seconds of their own, and no `command:` probe. A row the budget never
    reached, or one waiting on such a row, is named where it was written down and its line says so. The reverse
    also holds: when `handover list`'s own sixty-second sweep runs out first, find-card can place a row it checked
    that the list leaves as written.

  Measured on the live board: 7.1s end to end. With the machine loaded and the board at 9,509 rows, the same call
  took 14.8s and 18.5s with the drafts searched and 21.1s on `main` without them
  (`time slopweaver talk find-card voice other agents browser slopweaver verbs commands | head -1`). Reading the draft
  register does not move it, but a loaded machine can push the call past the verb tool's sixteen seconds.

  On one call it did. The voice said "The Queue search timed out", and the owner called it a P0. That board held 10,264 docs (104 MB) and 5,467 journals. The call read every doc in turn, then opened every one again
  for the owner's words. Both runs below are under `tsx`, as the installed app's main checkout runs a verb, at load average
  ~35 (`time tsx src/cli/index.ts talk find-card apple developer account signing access it-support`):
  - the serial reads took 19.7s;
  - one concurrent read took 8.2s and 10.1s;
  - the `--json` answers matched field for field.

- **"On your Queue" only when the Queue draws it.** The Queue draws a row only when its `ownerWait` names the owner
  (`site/lib/ownerAsks.ts`), and a row carrying an open recorded question can be already ruled, settled or paused. So
  the verb reads each composed row's verdict the way `handover list --json` publishes it (`publishedWaitOf`), and
  that verdict, never the section, decides what it says. A row waiting on the owner says "on your Queue" in any section, since the board
  can place a row that is the owner's in LOOKS SHIPPED; already ruled, settled or paused say "not on your Queue" and why in
  any section, since a settled ask composes to DONE or CLOSED — NOT SHIPPED (`src/talk/cardFindLines.ts`). A run whose
  doc left the board while it is still waiting on the owner is searched too, swept as `handover list` sweeps it (`recoverListJournals`):
  an archived doc's row by its own text, a deleted one's by its question, both on the owner's Queue as the Queue draws them.
  Without that, a project's briefing already ruled on was once named as on the owner's Queue; the voice called
  `open_card` on it and the console refused it in front of the owner.
