---
name: chatgpt
description: Bring the owner's ChatGPT history onto this machine — every conversation on the account held whole through the owner's web session and kept fresh into the corpus and the store, the official data export as backup and cross-check, a listing of the account, or one named conversation read live by id. Use when the owner asks for the owner's ChatGPT history to be searchable or kept in sync, has downloaded a ChatGPT export, asks what chats the account holds, names a chat the owner wants read, or pastes a chatgpt.com request from DevTools. Phrases like "sync my ChatGPT", "backfill my ChatGPT history", "I downloaded my ChatGPT export", "list my ChatGPT chats", "pull my ChatGPT conversation", "read that voice chat from my phone", "chatgpt.com/c/<id>", "I pasted the request into a file".
argument-hint: live-sync [--max-conversations <n>] | sync [--from <zip|dir>] | import-export [--from <zip|dir|file>] | import-request --from <file> | list | conversation <id>
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" chatgpt $ARGUMENTS` and report the result.

## Two paths, and the line between them

- **The web session is the ingest path.** `chatgpt live-sync` holds every conversation on the account whole
  (main, archived, each Project's), newest first, then refreshes them into the corpus and the store as the
  `chatgpt` source (the owner's ruling: full history, then ongoing sync, never hand-picked). `chatgpt list` lists
  the account and `chatgpt conversation` reads one named chat whole. The API is ChatGPT's private web API,
  undocumented and able to change shape or close, so each endpoint reads through a strict boundary and every
  verb prints that caveat.
- **The official export is the backup and cross-check.** The owner downloads it from chatgpt.com → Settings →
  Data controls → Export data, and `chatgpt sync` takes it in. The refresh weighs every held export and the live
  copy as versions of one chat, so a chat held both ways is written once. The browser is never driven.

## Which verb

```bash
slopweaver chatgpt live-sync                   # every chat on the account held whole, newest first, then refreshed
slopweaver chatgpt sync                        # every new export in ~/Downloads -> corpus + store, receipt last
slopweaver chatgpt sync --replay               # after a bronze or store rebuild: refresh again though all is receipted
slopweaver chatgpt import-export --from <zip>  # take one export in; reads nothing into the corpus
slopweaver refresh --source chatgpt --store    # re-read every held export and the live copy, each chat from its latest version
slopweaver chatgpt import-request --from ~/request.txt           # the owner's pasted request -> 0600 session
slopweaver chatgpt list                        # every conversation on the account, paced; writes nothing
slopweaver chatgpt conversation <conversation-id>  # read that chat whole, live
```

**`sync`** takes in every export zip in Downloads that is not yet held (a held one re-saved
after a newer one never hides it); a zip unchanged since it was taken in (same inode, size and change time, its export
still held: `exports/chatgpt/archive-index.json`) is recognised without being extracted again. While any held
export has no receipt it refreshes, and writes the receipts only after a refresh that exited 0 or 3; a row the
store refused fails that refresh. A failed refresh leaves no receipt, so the next sync retries. With every held export already in, it exits 3
while the corpus is inside ChatGPT's one-day freshness window, else 4 (deferred) naming its age: the corpus is
only as current as the owner's last export, and a re-download with nothing new in it (the same bytes, so already held)
counts from its file's time. An export is dated by when the owner came by it (the zip's modified time, or a folder's
newest file), never by when it was taken in, so a months-old zip taken in today is as current as its own date.
The newest export is the one whose chats run latest, then the one the owner came by later, never the one taken in last,
so an old zip named with `--from` after a newer one stays older; two that tie on both share one date, so either
dates the corpus alike. That order dates the corpus; it never picks which copy of a chat is written. A refresh reads EVERY
held export, receipted or not, and writes each chat from the version whose own last update is latest, so a chat
the owner deleted lives on from the export that held it, and an older export never wins a chat a newer one changed. Two
differing versions of one chat with the same last update fail the refresh, naming both exports. A held export whose manifest will not read, or whose files no longer
match what was taken in (deleted, resized, a link, or rewritten), fails `sync` and the refresh (exit 1) until that
directory is moved aside and its zip taken in again, never passed over. That holds for EVERY held export on every
pass, a receipted older one included; `exports/chatgpt/verified-index.json` skips re-hashing one whose files are
unwritten since it last matched. After bronze or the store is rebuilt, `chatgpt sync --replay` forgets every
receipt, so a refresh runs again. A take-in writes at most 8 GiB, or the disk's free space less 2 GiB:
`unzip` is cut off past that while it writes, and the copy is removed. Once a
home holds its first export, `automation register-resyncs` seats a daily `resync-corpus-chatgpt` row that runs
it; a pass that succeeds stamps the verified-sync clock at the instant the sync certified the export current as
of (`exports/chatgpt/as-of.json`, bound to the newest held export), never the instant the pass finished, and a
deferral keeps the slot open, so the freshness page goes stale a day after the owner's last export until the owner downloads
another. A home
that never exported gets no row, and sync exits 3.

**`import-export`** copies the export's `conversations*.json` files under
`$SLOPWEAVER_HOME/corpus/exports/chatgpt/<content-hash>/` at `0700`/`0600`, with a manifest. The same export
taken in twice is held once. A zip is listed and extracted by `unzip`, and any member whose name would escape
the directory, or collides with another, is refused. A numbered run must count up from `000` with none missing, since
a missing file is a whole file of history read short. An unzipped folder is listed at every depth, like a zip: a
conversations file deeper than one folder down, or a subfolder that will not list, refuses it. One conversations
file named with `--from` is taken only when it is the whole export: one part of a split export (a numbered file
past `000`, or any with another conversations file beside it) is refused, so name the folder. A zip `sync` finds
that will not list, holds conversations files but not as one export, names one in a shape this reader does not
know, or holds the export's `chat.html` with none it knows, fails the sync, naming it, rather than being passed
over while an older corpus is called current; an unrelated broken zip there is moved out of the folder.

**What the refresh reads.** It reads each conversation's messages from both the current branch and every
regenerated alternate, one record per message, linked to their parent. The system prompt, custom
instructions, calls to a tool it knows and model thoughts are withheld and counted. A content kind, assistant
recipient or a recording with no transcription the reader does not know is a coverage gap naming it, never a
silent skip. So is a chat whose id is not the UUID the live read
takes, or whose `id` and `conversation_id` disagree. It is a whole snapshot with no cursor, so `--since`,
`--lookback-days`, `--sample` and `--fetch-cap` are refused beside it.

**A local history, not a mirror.** A chat deleted on chatgpt.com stays in the corpus. Removing it is a store
content removal by hand.

## The web-session reads

1. **A session first.** The owner copies the Request Headers of any signed-in `chatgpt.com/backend-api` request
   from Chrome DevTools into a file. `import-request` keeps five headers (authorization, cookie,
   chatgpt-account-id, oai-did, user-agent) in `secrets/chatgpt-web-session.json` at `0600`, prints their
   NAMES and the bearer's expiry, and removes the file it read. Never print, paste or commit a value.
2. **The listing.** `list` walks the active lane, the archived lane, then every Project's chats, one GET at a time
   at least three seconds apart. The first `429`, expired session or challenge stops it, and nothing is retried in
   that run. It prints counts per lane, the update span and the bearer's expiry; `--json` carries every listed
   conversation. A Project chat also listed in the main list is counted once, as a repeat.
3. **The live sync.** `live-sync` lists the account as `list` does, then reads whole every chat the live copy
   does not hold at its listed update, one response per chat from the singular conversation endpoint, newest
   first. It holds each under `corpus/chatgpt/live` the moment it is read. The first run is the full-history
   backfill: about 2,267 chats at one request every three to five seconds is hours, so run it as a background
   job. Each later run reads only what changed. The first refusal stops every further request, and the next run
   picks up exactly where it stopped, since the snapshots are its only state. Whenever the live copy holds
   anything it then runs the chatgpt refresh into the store, in process. Exit 3 when nothing is held or new, 4
   while another run holds the lock. `--max-conversations` bounds one run.
   - **The listing is carried.** A completed listing is held beside the snapshots (`listing-carry.json`), so the
     next run lists only what moved since it began (the chats of a stopped backfill that were never read are
     still in the carry) instead of paying for the whole listing again. It is trusted for three days, then the whole
     account is listed again, which is also what notices a chat deleted on chatgpt.com and a chat only a Project
     names (a carried walk skips the Projects lane; the one whole walk found every Project chat in the main list
     too); `--relist` forces that. A chat ChatGPT answers `404` for is deleted: the run names it, drops it from
     the carry and reads on, where any other refusal still stops the run.
     A listing page answered with a 5xx is retried three times after 30, 60 and 120 seconds; a `429` or any other
     refusal is never retried. A stopped listing prints the lane it stopped in, with the offset (active, archived) or the page (projects), and a stopped walk
     leaves the last carry in place.
   - **The daily row.** Once the live copy holds a chat, `automation register-resyncs` points the daily
     `resync-corpus-chatgpt` row at `live-sync` instead of `sync`. A run that held every listed chat and
     refreshed records `corpus/chatgpt/live/as-of.json` at the instant its listing began. The row is current as
     of the later of that and the export's own record. A stopped or bounded run records nothing, so the
     freshness page ages.
4. **One chat.** `conversation` pages newest-first until the backend says nothing is older, then writes
   `messages.jsonl` and `transcript.md` under `$SLOPWEAVER_HOME/live/chatgpt/conversations/<id>/`. Past
   `--max-pages` it refuses and writes nothing, because a transcript missing its opening reads like a whole
   one. A corpus `chatgpt` record plans this exact read by its conversation id.

A `401`/`403` means the session expired: ask the owner for a fresh paste through the hand step, never a sign-in by
the fleet. A `NOT_JSON` answer is Cloudflare's challenge page, and a fresh paste clears it too.
`PAGE_MALFORMED` naming a `new field` is the backend's shape moving: each endpoint reads through a strict
boundary (`conversation.ts`), and one line declaring that key there is the fix — never a looser schema.

Boundary: [security § ChatGPT](../../docs/security/chatgpt-conversation-boundary.md).
