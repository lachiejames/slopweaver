---
name: drive
description: Authorise a Google Drive once by browser consent, then list and read files through the slopweaver door with explicit bounds and stated residue. Use when the user asks what files are in their Drive, to find a document, to read a Google Doc, Sheet or Slides deck, to see what is in a folder, to check which shared drives exist, to check which account slopweaver is connected to, or to connect Google Drive in the first place. Phrases like "what's in my drive", "find that doc", "read this google doc", "what's in that folder", "which shared drives do we have", "connect my drive", "am I connected to drive".
argument-hint: connect [--grant metadata|read|write] | drives | list [--query "name contains 'x'"] [--folder <id>] [--drive <id>] | read <file-id-or-url> [--metadata-only]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" drive $ARGUMENTS` and report the result.

## The door, and what is behind it

`connect`, `drives`, `list` and `read` are the whole of the Drive surface. Never reach for raw HTTP, `curl`,
a Google MCP tool, a browser scrape or a second client to do something a verb does not: the absence is the
answer, not an obstacle. Use the world model for history and discovery; it cannot establish what is in the
Drive right now.

**No verb here writes.** `--grant write` (below) lets the credential carry write scopes, but no verb creates,
renames, moves, shares, trashes or deletes anything, and `metadata` and `read` are read-only Google grants.
So a request to "put this in Drive" or "share that folder" is not something to work around with a raw call;
say the door does not do it.

## The three grants, and why the narrow one is the default

Google draws its sharpest line here and the verbs follow it exactly:

- **`--grant metadata`** (the default) is `drive.metadata.readonly`. It enumerates and describes every file
  — names, types, sizes, owners, folder parents, dates — and **cannot read one byte of any of them**.
- **`--grant read`** adds `drive.readonly`, which can.
- **`--grant write`** adds `drive.file` and `documents` — the owner wants write
  capabilities on their gmail, drive, docs and calendar, on their word.

An install that only ever answers "what is in here, who owns it, when did it change" therefore never hands
this application the ability to read the files themselves. `list` and `drives` need only the narrow grant;
`read` needs the wide one and refuses at the door — naming the missing scope — rather than failing halfway
through with a 403 that names nothing.

**What the write grant still CANNOT do is the reason it is those two scopes.** `drive.file` is per-file: it
reaches only what this application itself created, or what the owner explicitly opened with it, so a shared
drive is outside the credential rather than outside a policy check. `documents` edits a Doc the owner can already
open and deletes nothing — and does not touch a Sheet or a deck. `https://www.googleapis.com/auth/drive`,
the one that could wipe a company drive, is kept out by an exact-set assertion in
`src/__tests__/unit/live/google/actsOnlyAsTheBoundAccount.test.ts`. Say that trade out loud when the owner asks why
something could not be written: the answer is almost always "that file is not one this application created".

**The Drive grant is its own credential file**, `secrets/drive-oauth.json`, separate from the mail door's.
Revoking one leaves the other working, and a Drive-shaped scope can never ride along on a consent screen the
owner opened to read their mail. The OAuth CLIENT is shared with the mail and calendar doors
(`google-client-id` / `google-client-secret`) — that identifies the application, not the account — and is
NOT shared with the Google Admin door, which consents through `google-admin-client-id` so that no admin
credential can ever carry a write scope.

## The three residues you must carry into any answer

A Drive is the source where "here is what I found" reads most convincingly as "here is everything". It never
is, and every document says so in its own words. Repeat them rather than smoothing them over:

- **A shared drive is a SEPARATE corpus.** A `list` with no `--drive` searches My Drive and what is shared
  into it, and genuinely does not see a shared drive's files — however much the browser makes it look like
  one Drive. `drive drives` lists the ids; a search that found nothing may simply have searched the wrong
  one, and you should say so before concluding a file does not exist.
- **A listing is one page.** The residue says when more matched than was read. Never present a page as a
  total, and never total up a count from one.
- **A binary file's bytes are never downloaded.** `read` returns a PDF's or an image's metadata and states
  plainly that nothing in the answer reflects its content. Only a Google Doc, Sheet or Slides deck has a
  text export at all — a Doc as plain text, a Sheet as CSV (ONE sheet, which is Google's limit and not
  this door's), a deck as plain text.

## Reading one file

`drive read` takes **the URL out of the browser bar** as readily as a bare id — `/file/d/<id>/`,
`/document/d/<id>/`, `/spreadsheets/d/<id>/` and the older `?id=<id>` all resolve. Prefer pasting the URL
the person actually has over asking them to extract an id.

`--metadata-only` skips the text export even for a document that has one. Reach for it when the question is
about the file rather than its contents (who owns it, when it last changed, which folder it is in), because
a whole Doc in the transcript is a wall of text nobody asked for.

## Meeting transcripts are INGESTED by the mail door, and SEARCHED here before "none exists"

A Gemini / Google Meet meeting-notes document reaches the world model through `refresh --source gmail`,
which follows the link in the notes email and stores the raw transcript block (owner ruling:
the tool's own summary is dropped entirely). For WHAT one says, ask the world model first. For WHETHER one
exists, an empty store is not the answer: a transcript filed in Drive, or mailed since the last load, never
reached it, so search this door — shared drives included — before saying there is none
([artifact asks](../loop-bot/reference/artifact-asks.md)).

## Detail

- Connecting, the grant file, and what a narrowed consent looks like: [connecting](reference/connecting.md)
- Searching, the `q` expression and shared drives: [searching](reference/searching.md)
