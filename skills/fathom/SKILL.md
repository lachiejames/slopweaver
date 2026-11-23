---
name: fathom
description: Read a Fathom call somebody else recorded and shared with you — its RAW transcript by speaker, never the summary — into the fathom source, find the share links waiting in Fathom's own mail, and clear that mail from the inbox once its meeting is held. Use when a Fathom share link or recap mail arrives, when a meeting a colleague or consultant recorded is missing from the corpus, when Fathom mail sits in the inbox, or when asked what was said on a shared call. Phrases like "read this fathom link", "ingest the fathom recording", "fathom.video/share", "Felix shared a recap", "any new fathom calls", "archive the fathom recaps", "what did they say on the Auditco call".
argument-hint: share <https://fathom.video/share/<token>> [--dry-run] [--no-store] | discover [--ingest] [--limit <n>] | clear-inbox [--dry-run] [--limit <n>]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" fathom $ARGUMENTS` and report the result.

## The one rule: raw words by speaker, never what Fathom wrote

Never keep the summary; keep the RAW verbatim transcript by
speaker. A fathom row is `[HH:MM:SS] Speaker: text`, one line per spoken cue. Fathom's summary and its
ACTION ITEM notes never reach this machine: `share` drops the notes in the page and reports only how many.
The recap MAIL is a different thing and stays in the gmail source. Never paste a summary into the corpus
by hand — the four hand-written `share:<token>` rows that once did were the reason this verb exists.

## The recap mail is never read for content, and never carded

The owner wants nothing to do with Fathom recap emails: archive every one, but make sure the transcripts are
actually ingested. So `gmail triage` holds Fathom's mail out of
every group (`src/live/gmail/triage.ts`), and a meeting reaches a session only through this noun — never cite
or summarise a recap mail. The mail's one use is the signal that a call was shared: `clear-inbox` ingests it
and only then archives it.

## Which verb

```bash
slopweaver fathom discover                               # which share links in Fathom's mail are not held yet
slopweaver fathom discover --ingest                      # ...and read each new one with `share`
slopweaver fathom share https://fathom.video/share/<t>   # one link: read, store, replace any hand-written row
slopweaver fathom share <url> --dry-run                  # read and print; write nothing
slopweaver fathom clear-inbox                            # ingest each unheld link, then archive what is proven held
slopweaver fathom clear-inbox --dry-run                  # ingest nothing, archive nothing; say what it would
```

`clear-inbox` archives an INBOX mail only when it carries a share link and every link it carries is in fathom
bronze after the ingest pass, through `gmail archive`'s own door-routed run. A failed share read or store settle
archives NOTHING that pass (exit 1); a mail with no share link is kept and named, since no meeting can be proven
held for it. No Fathom mail in the inbox is exit 3.

Calls the OWNER recorded come in through `refresh --source fathom` (the owner's API key). A call someone ELSE
recorded is invisible to that key, whatever you do, and reaches the owner only as a share link — which is what this noun is for.

## What `share` does, in order

1. Refuses anything but `https://fathom.video/share/<token>` before opening a browser.
2. Opens the page in the owner's own signed-in Chrome through the relay, clicks nothing, reads the page's own
   call and cue properties. An anonymous read redirects to sign-in, so a `NOT_SHOWN` means the owner's Chrome is not
   signed in to Fathom — say so; never try another route.
3. Commits one private record keyed on the RECORDING id (the API lane's key, so a call reachable both ways
   is one row), dated by when the recording started, cited by the share URL.
4. Removes every version of a hand-written `share:<token>` row from bronze, then SETTLES the store: retires the
   `share:` identity of every token bronze holds a transcript for, and replays the fathom source. `--no-store`
   stops after bronze. It never moves the fathom watermark.
5. WITHHOLDS that replay while any other hand-written `share:` row is still in bronze, naming its tokens: the
   replay is whole-source and would store that row's Fathom action items. Share each named link; the last one
   replays and retires them all.

Re-running on an unchanged call writes nothing to bronze and settles the store again. `discover --ingest` ends
with a settle whenever its last share did not run one, so a share whose store leg failed on an earlier pass is
repaired by the next. `discover` reads mail on the Gmail read grant, ONE page, newest first: when more matches,
it says how many it read of about how many, and a share only older mail carries is not listed.
Boundaries: [security § recorded-call](../../docs/security/recorded-call-boundary.md), [store § fathom](../../docs/store/bronze-and-source-coverage.md#the-fathom-source-holds-raw-transcripts-by-speaker-and-nothing-else).
