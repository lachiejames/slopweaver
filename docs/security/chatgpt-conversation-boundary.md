# ChatGPT: the history export and the web-session reads (`chatgpt sync`, `chatgpt list`, `chatgpt live-sync`, `chatgpt conversation`)

Part of [Security & trust](../security.md).

The owner talks to ChatGPT, often by voice, on the owner's own account and away from this machine. Two paths
bring that history here, and they have different boundaries:

- **The official data export, a file the owner downloaded.** The owner requests it at chatgpt.com → Settings →
  Data controls → Export data, and `slopweaver chatgpt sync` reads the zip from `~/Downloads` into the corpus and
  the store. **Nothing leaves the machine on this path.** It makes no network call, holds no credential, and
  writes only under `$SLOPWEAVER_HOME`.
- **The owner's web session, reading the account back.** The owner wants every conversation in the store, kept
  fresh, without hand-picking chats. `chatgpt live-sync` holds every conversation on the account whole and
  refreshes them into the corpus and the store, `chatgpt list` lists them, and `chatgpt conversation` reads a named
  one whole. These are reads FROM OpenAI, not egress TO it: what leaves the machine is the owner's own session and
  the paths below, sent to the account they came from. The export stays the backup and cross-check.

## The export path

- **The archive is untrusted input.** `unzip` lists it and extracts only the conversations files. A member
  is refused if it is absolute, backslashed, climbs out of the archive, repeats a file name, or sits under a
  second folder. An extracted member that turns out to be a symbolic link is refused too, and every file is
  opened exclusively (`wx`). A file is split one array element at a time
  (`src/lib/jsonArrayElements.ts`), so a heavy account's file never passes through one JS string.
- **What is kept is the owner's, and private.** The conversations files are copied under
  `$SLOPWEAVER_HOME/corpus/exports/chatgpt/<content-hash>/` at `0600` under `0700`. Every record is
  `visibility: private`. The system prompt, custom instructions, tool calls, tool output and model thoughts
  are withheld and counted, never stored.
- **A local history, not a mirror.** A chat deleted on chatgpt.com stays in the corpus until it is removed
  from the store by hand.

## The web-session reads

- **A private, undocumented API.** There is no official API for a chatgpt.com account: the `openai` SDK speaks
  the platform API, which cannot see one. The web backend the ChatGPT app itself calls can change shape or close
  without notice. So every endpoint is read through a strict boundary (`src/lib/boundary.ts`), and a key added,
  dropped or retyped stops the read by name rather than being read past. Every web-session verb prints this caveat.
- **The credential is the owner's own browser session, pasted by the owner.** The owner copies the Request Headers
  of a signed-in `chatgpt.com/backend-api` request out of Chrome DevTools into a file, and
  `slopweaver chatgpt import-request --from <file>` keeps five of them (authorization, cookie,
  chatgpt-account-id, oai-did, user-agent) in `secrets/chatgpt-web-session.json` at `0600`, then REMOVES the
  file it read. It prints header names and the bearer's own `exp`, never a value, and a refusal names a
  header rather than quoting one. MEASURED: a plain Node `fetch` with those five answered HTTP 200
  JSON through Cloudflare, and the bearer carried a ten-day `exp`. The cookie's life is unmeasured.
- **That session can do anything the owner can, so the code is the limit.** Every request is a GET to a path
  built in code from constants and validated ids (`src/cli/commands/chatgpt/conversation.ts`, `listing.ts`,
  `wholeConversation.ts`). The
  one response-derived value ever sent back is a listing's own opaque paging cursor, URL-encoded into the query of
  the path it came from. There is no write path. A redirect is refused rather than followed (`redirect:
"manual"`), because following one would let the server choose the URL the session is sent to.
- **The owner's account is read gently.** `chatgpt list` and `chatgpt live-sync` make one request at a time
  through one pacer per run, each at least three seconds after the last plus up to two more at random
  (`pacer.ts`), at the page size the web app's own sidebar uses. The first `429`, `401`/`403` or Cloudflare
  challenge stops the whole run, and nothing is retried in the same run. One `live-sync` runs at a time per home,
  under an operation lock. The limits themselves were deliberately never probed, because probing them is what
  could flag the account. MEASURED: one whole listing of an account with 2,267 conversations took 104 requests and
  met no refusal (`slopweaver chatgpt list` prints both counts).
- **What `list` reads.** The active lane, the archived lane and every ChatGPT Project's chats: id, title and
  create and update instants. It writes nothing. Its default output is counts and instants, never a title;
  `--json` carries the listing, because printing it is what that flag asks for.
- **What `live-sync` writes.** Each chat's whole body, exactly as `GET /backend-api/conversation/<id>` sent it,
  lands in `$SLOPWEAVER_HOME/corpus/chatgpt/live/snapshots/<id>/` at `0600` under `0700`, beside a manifest naming
  its sha256 and the update the listing gave it (`src/corpus/chatgpt/liveSnapshotStore.ts`). Those snapshots are
  the run's only resume state: a chat is read again only when the listing's update moves. `refresh --source
chatgpt` reads them through the export's own parser, so a chat held both ways is one conversation with two
  versions, written once, every record `visibility: private`. The raw snapshots are not in the encrypted backup,
  like the raw exports; the bronze projected from them is. It prints counts and instants, never a title.
- **What `conversation` writes.** `messages.jsonl` and `transcript.md` land in
  `$SLOPWEAVER_HOME/live/chatgpt/conversations/<id>/` at `0600` under `0700`. That is the `live` tier, where
  reads are fetched on demand and never ingested. `refresh --source chatgpt` reads the held exports and the
  live-sync snapshots, never the session itself. Past `--max-pages` (default 200 pages of ten turns) it writes nothing, because a transcript missing its
  opening reads exactly like a whole one, and a cursor that does not move is refused too.
- **Expiry is the provider's, and the fix is the owner's.** A `401`/`403` or a Cloudflare challenge page
  (`NOT_JSON`) means the pasted session no longer works. The fleet asks the owner for a fresh paste; it never
  signs in to the owner's account.
