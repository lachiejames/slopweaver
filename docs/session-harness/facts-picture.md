# The facts picture

Part of [the session harness](../session-harness.md).

`slopweaver cmux picture <handle> --harness app [--json]` asks the desktop app `picture.read` for one session it
hosts and prints what that session has DONE in this run of the app: which tools it called, of which kind, and how
each ended. It is the picture's FACTS layer only. Read-only: one socket question, nothing written.

## What crosses, and what never does

The digest of a tool call's id, its kind, its status, the digest of the call that started its subagent, and the
vendor's tool name when that name is a bare identifier (`^[A-Za-z0-9_.:-]+$`, at most 256 bytes). Nothing else: both
guards refuse an id that is not `sha256:` and 64 lowercase hex digits, and a name that is not such an identifier.

- **No title, ever.** ACP's `title` is commonly the command line or the path itself, so the Codex worker never reads
  it, and no field on the wire carries one.
- **No input or output.** ACP's `rawInput`, `rawOutput`, `content`, `locations` and `_meta`, and Claude's `tool_use`
  input, `tool_result` content and `tool_use_result`, are never read: a tool's input and output can hold a secret
  or the owner's private data.
- **No words.** The picture's session header is identity and state alone: never what was sent to the session or what
  it said, which the card shows and the picture does not.
- **Every call and parent id crosses as its digest**, `sha256:<hex>` of the vendor's id, so a call still pairs its
  start with its end while nothing the vendor wrote crosses: a vendor that puts a one-word command or a file name in
  its id sends none of it.
- **A name that is not an identifier is dropped**, never shortened: a command with arguments in a name field reads as
  no name. A name that is one crosses as the tool's identity, which is what the picture is for.

The worker wire's guard (`desktop/src/sessionWorker/workerWire.ts`) refuses a tool activity carrying any other key,
and the picture wire's (`pictureWire.ts`) refuses a picture carrying any field it does not declare.
`desktop/__tests__/unit/toolActivity.test.ts` pins it with a tool call whose title IS its command.

## Where each fact comes from

| Vendor | Start                                                                   | End                                                                                |
| ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Claude | an assistant message's `tool_use` block: in progress, kind by tool name | a user message's `tool_result`: failed when `is_error`, else completed             |
| Codex  | ACP `session/update` `tool_call`: its own `kind` and `status`           | a `tool_call_update` with a terminal status; a field it leaves out keeps its value |

Claude's kinds come from Claude Code's own tools (`Bash` execute, `Read` read, `Edit`/`Write` edit, `Grep`/`Glob`
search, `WebFetch` fetch, `Agent`/`Task` delegate); any other, an MCP tool's included, is `other`. A subagent's tool
call is a fact whoever made it, carrying the subagent's starting call as its parent; a subagent's words still never
reach the card. A replayed message reports nothing, because the call it ends was not made in this run of the app.

## The fold

`desktop/src/sessionFacts.ts` folds each report, stamped with the instant the control plane received it (neither
vendor stamps when a tool ran):

- **A call is counted once**, under the kind it arrived with, or `other` when it named none; an update that corrects
  the kind moves the count.
- **An orphan end**, a result never seen starting, is counted and filed as ended.
- **Ended is final.** A later report about an ended call changes only the session's last-activity instant: it never
  moves the call back in flight or counts it again.
- **Bounded by construction:** at most 64 calls in flight and the 20 newest ended. A new call reported while 64 are in
  flight is not stored and counts in `droppedActivityEvents`, and the counts by kind are then a floor, which the text
  output says.

## Limits, stated

- **Nothing persists**: a restarted app starts every session's picture again, as it does its usage.
- **The digest is unsalted.** Anyone who already holds a picture can confirm a short or guessable vendor id by guessing
  it and hashing the guess. The picture never leaves the owner-only socket.
- **The session title is unbounded**, as `session.launch` accepts it and `session.list` returns it. Only a title near
  the socket's 1 MiB line limit could push a full picture over it, and that title would overflow `session.list` too.
- **An ended call aged out of the newest 20 would count again** if a vendor re-sent it. Neither is known to re-send a
  finished call within a run; the installed-app trial checks it.
- **An app from before this refuses `picture.read` as `BAD_REQUEST`**, which the verb reports as an app to update.
- **`--harness cmux` is refused**: cmux hosts no worker to observe a tool call.
