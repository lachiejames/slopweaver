---
name: reading
description: The readings ledger — record the --json document a slow verb printed (github landing, the tick's gauges) with who took it and when it was true, and read the latest one back. What a console page shows instead of taking a 68-second read itself and calling that live. Use when a sweep tick or a seat has just run a verb whose document a page shows, when a page must say "read N ago by whom", or when you want to know what the last reading of something was without re-taking it. Phrases like "record this reading", "what was the last landing read", "how old is the reading the page shows", "sync the pull-request page".
argument-hint: "record --producer <verb line> --from <file> --by <who> [--observed-at <iso>] | last --producer <verb line> [--json] | list [--producer <verb line>]"
---

A page never reads GitHub. It reads a ledger of readings and says which reading it is showing. This noun is
that ledger.

## Why it exists, from the owner

The console lied: a board said a pull request was green, the owner clicked through, and it had conflicts or
a review nobody had handled. Three defects hide in that, and the third is **a poll nobody watched** — a page
that took its own read on a cadence nobody saw, so a stale answer looked exactly like a fresh one. The owner's fix, relayed:
rows derived from the supervisor tick's own gauges, "how long since last sync" on every list, and a page that
takes a fresh reading when its own is due.

The plan page chose a ledger every actor appends to over a page that reads the tick row alone:
reading the tick row only would make the page as stale as the tick cadence, and turn the page's own refresh
into something that has to wake the chair.

## What a reading is

One verb's complete `--json` document, kept as the **bytes it printed**, with three facts beside it:

- **`producer`** — the verb WORDS, without flags: `github landing`, `claude gauge`. The slug is the
  producer lowercased with every non-alphanumeric run folded to `-`, so a flag spelled into it WOULD split
  the key; `tick-capture` strips its argv to the words before the first `--` for exactly that reason.
- **`by`** — who took it: `tick-12`, a session id, `sync-now` (a page's own reading through `site/app/api/sync/[verb]`:
  the pull-requests page's refresh of a due landing, or the Queue's currency check on opening). The name a page prints
  after "read N ago by".
- **`observedAtIso`** — when the document was TRUE. The producer's own instant when it stamps one, else
  `--observed-at`, else the recording instant; the receipt says which.

The document lives at `$SLOPWEAVER_HOME/readings/<producer slug>/<instant>.json`; the row lives in
`readings/index.jsonl`. `src/readings/store.ts` writes the document first and the row second, so a row can
never name a document that did not land.

## Recording one

```bash
slopweaver github landing --author @me --json --include-drafts > "$dir/landing.json" \
  && slopweaver reading record --producer "github landing" --from "$dir/landing.json" --by tick-12
```

**Record the console's own selection, never a narrower one.** A page shows the LAST document under a producer,
whatever selection took it, so a landing recorded from one checkout's origin with no author replaces every
repository of the console's selection with one and everyone's pull requests. A `github landing` document
whose `selection` is not `@me` is refused here exactly as `--record-reading` refuses it (`src/readings/landingSelection.ts`).

Three producers record without being asked:

- **`github landing --record-reading <by>`** appends the document it just printed, whatever else the
  invocation did — sweep step 7 passes `--record-reading tick-<n>`, so the page and the tick show the same
  bytes ([sweep-contract.md](../supervisor/reference/sweep-contract.md)).
- **`handover currency --record-reading <by>`** appends the exact document `--json` prints, observed at its own
  `checkedIso`. The Queue runs it as `sync-now` once per opening when the check it shows is ten minutes old or
  missing (`site/lib/currencyOpeningRefresh.ts`); it still prints the document when the ledger refuses the append,
  then exits 1, so the sync route never calls a reading taken that was not recorded.
- **`supervisor tick-capture`** takes a `session watch` reading that exited 0 with nothing on stdout ONCE more
  (`retryWhenEmpty`), keeps only that second attempt, and calls it failed if it is empty again.
- **`supervisor tick-capture`** records every completed, non-empty JSON reading it took, by `tick-<label>`,
  under the verb words of its argv (`claude gauge --json` → `claude gauge`); a text reading is not a
  document and is left out, and so is a **cadence skip** — a document whose top-level `kind` is `skipped`,
  which `github landing --if-due` prints when the tick is not due. A skip says nothing was read, so it is
  never a reading (`isSkipDocument`, `src/readings/row.ts`). `--home <dir>` points both the ledger and nothing
  else at another state home.

`--from -` reads stdin. A file that is not JSON is refused before anything is written.

## Reading it back

```bash
slopweaver reading last --producer "github landing" --json   # one object: readingId, producer, by,
                                                             # observedAtIso, recordedAtIso, bytes, document
slopweaver reading list                                      # every row, oldest first
```

`last` answers the newest document that IS a reading, passing over any cadence skip recorded after it — a
seat running older code, or a hand `reading record`, can still append one, and the console's sidebar badges
went blank for the half hour a skip stood as the latest landing. So `list`, which prints every row,
can name a newer row than `last` does; that is the history and the reading disagreeing on purpose. A missing
or unparseable document is still refused at its row, never passed over.

`last` exits **3** when the ledger holds no reading by that producer — skips alone included. That is a fact a page shows in words —
"no reading yet, run …" — never an empty document, and never exit 1, which is reserved for an index that
could not be read. The site's `landing-reading` allowlist row is exactly this verb; `observedAtIso` sits at
the top of the object so the tile stamps the reading with the instant it was true.

## Where it lives, and what that means

Under `$SLOPWEAVER_HOME/readings/`, a SIBLING of `ledgers/`: what it holds is not a log of acts but the last
known state of the world as a verb printed it. Owner-only permissions, like every register under the home —
a landing document names pull requests, reviewers and Slack asks. The index is streamed on every read
(`whole-file-json`), and a document is read whole through `safeJsonParse`, which refuses at the house size.

Nothing here prunes. One file per reading is the design, and a `reading prune` is a board row when the
directory earns one — never a silent rotation a page could be reading across.
