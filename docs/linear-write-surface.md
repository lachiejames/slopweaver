# The Linear write surface, and how it compares to Linear's own MCP server

What this door can write to Linear, what each write guarantees, and — the owner's ask —
**where that leaves us ahead of or behind Linear's own MCP server.**

Enumerate the live surface rather than trusting this file's list: `slopweaver catalog | grep -A 20 '^linear$'`.

## What the door writes

Every row is a `slopweaver linear …` verb. All of them take a typed form, render the provider payload in
code, and route the effect through the admit door.

| Verb                              | Linear mutation(s)                                                  | Cassette                           |
| --------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `issue create\|update`            | `issueCreate`, `issueUpdate`                                        | `linearWrite.test.ts`              |
| `comment create`                  | `commentCreate`                                                     | `linearCommentWrite.test.ts`       |
| `relation create`                 | `issueRelationCreate`                                               | `linearCommentWrite.test.ts`       |
| `project create\|update`          | `projectCreate`, `projectUpdate`                                    | `linearProjectWrite.test.ts`       |
| `milestone create`                | `projectMilestoneCreate`                                            | `linearProjectWrite.test.ts`       |
| `project-update create`           | `projectUpdateCreate`                                               | `linearProjectUpdateWrite.test.ts` |
| `initiative create\|update\|link` | `initiativeCreate`, `initiativeUpdate`, `initiativeToProjectCreate` | `linearInitiativeWrite.test.ts`    |
| `initiative-update create`        | `initiativeUpdateCreate`                                            | `linearInitiativeWrite.test.ts`    |
| `document create\|update`         | `documentCreate`, `documentUpdate`                                  | `linearDocumentWrite.test.ts`      |
| `attach upload`                   | `fileUpload`, then a presigned PUT                                  | `linearAttach.test.ts`             |

Each suite records against a REAL workspace and replays offline under `yarn test:integration`. No recording
is committed, so each is quarantined in `config/vitest/integration.ts` until it is re-recorded
([re-recording](./integration-coverage.md#re-recording-a-cassette)).

## The finding that settled the images question

**Putting an image in a Linear comment needs no browser.** MEASURED: `mutation.fileUpload` takes
the same API key every other verb on this noun uses, hands back a presigned Google Cloud Storage slot, and
the bytes go in with one PUT. `github attach` needs the owner's own Chrome because GitHub's upload path is a
scraped page token behind a session cookie; Linear has a first-class API for it and the two are not the same
problem. `docs/browser-route.md` is not on this path at all.

Two properties of that path are the whole reason `attach` is a verb rather than one call:

- **A reservation's `assetUrl` is a promise, not a fact.** Linear mints it before the bytes exist, and it
  404s until the PUT lands. `putReservedAsset` returns a stored asset only on a 2xx, so a caller cannot hold
  a URL it has not proven — publishing one would render as a broken image in front of a colleague.
- **The size ceiling is the server's, and this repo does not copy it.** `fileUpload` takes `size` as a
  required argument and refuses the reservation itself, so the limit is stated on every call before a byte
  moves. A number pinned here could only go stale against it.

## Against Linear's MCP server

**What could be checked, and what could not.** Linear's MCP endpoint (`https://mcp.linear.app/mcp`) answers
**401** to an unauthenticated request — measured — so its tool list is behind an OAuth grant this
work did not have and did not ask for. Linear's own documentation states the scope in prose rather than
enumerating tools:

> "The Linear MCP server has tools available for finding, creating, and updating objects in Linear like
> issues, projects, and comments — with more functionality on the way."
> — `https://linear.app/docs/mcp`

So the comparison below is **capability class against that stated scope**, never tool name against tool
name. Making it authoritative means connecting an OAuth client to `mcp.linear.app` and enumerating
`tools/list`, which is new access and the owner's call — not a gap in this work.

### Where the door is AHEAD

Each of these is a property the door has and a documented general-purpose MCP tool surface does not, because
each costs a mechanism rather than an endpoint.

- **At-most-once by construction.** Every create carries a CALLER-CHOSEN id derived from the intent — a
  UUID-shaped digest of the form's own content. A retry after a lost response computes the same id, finds its
  own reservation and refuses. A tool that lets the provider mint the id cannot do this: a lost response is
  indistinguishable from a failure, so the retry files a second ticket.
- **Ownership, recorded locally.** Under a personal API key Linear attributes every mutation to the human who
  owns the key, so nothing on the object can prove what wrote it. The ledger under
  `$SLOPWEAVER_HOME/ledgers/linear-*` is the only evidence, and `update` refuses without it — fail-closed on
  every uncertainty.
- **A false success is a typed failure.** `CommentPayload.comment`, `ProjectPayload.project`,
  `InitiativePayload.initiative` and the rest are all nullable, so a 200 with `success: true` and a null
  object is a real API shape. Every parser names that case, and every create is established by READING THE
  OBJECT BACK at the id it chose rather than by trusting the mutation's own answer.
- **Shape is enforced by the schema, never by review.** Rule 7's arrangement is a refusal: a summary that
  runs to two lines, or past the word cap, or that opens Linear's `+++` collapsible delimiter, does not get
  sent and reworded — it is refused. A status update with no `health` is refused too, where Linear leaves the
  field optional and an omission silently leaves the project reading whatever it read before.
- **Bare references become links or the write refuses.** A status update's claims ARE ticket references, and
  every `ABC-1`/`#<number>` in a body must resolve to something a reader can open.
- **Mentions resolve exactly, or refuse by name.** An `@{key}` that matches more than one colleague names the
  candidates and stops. Notifying the wrong person is worse than refusing.
- **Every write is a door record.** The verb, the artifact, the effect class and the decision, in one ledger.
- **A visual is gated before it is sent.** `attach` runs the same invented-visual checks `github attach` does
  — a shot of a page served from this machine, a page or vector handed to an image slot, a chart a plotting
  library drew — and waiving one takes a stated reason that the door records.
- **A dead Datadog console host is refused before it reaches Linear.** The mutation sender
  (`src/corpus/linear/writeGraphql.ts`) judges every mutation's document and variables, and `attach upload`
  judges a file's bytes and name before a slot is reserved, all through `src/outbound/invalidDatadogHost.ts`,
  so a hit is refused before anything leaves. The reservation Linear hands back is judged too, and a hit there
  stops the upload before the PUT. Either refusal gives way only to its named escape hatch. The bytes are read
  as text, so a host inside a compressed stream, such as a PDF's, or drawn into an image, is not seen, and
  a redirect the storage server answers the PUT with is followed unjudged.

### Where the door is BEHIND

Stated plainly, because a comparison that only lists wins is not a comparison.

- **No deletes, no archives, no unarchives** on any object. The delete arms in
  `src/corpus/linear/write.ts`, `writeCreateOnly.ts`, `writeInitiative.ts` and `writeDocument.ts` exist for cassette teardown and no verb exposes any
  of them. Deliberate — the reversal of a mistaken write is a human's call in Linear's own UI — but it is a
  thing the MCP's "updating objects" scope may well cover and this door does not.
- **No comment edit and no comment resolve.** `commentUpdate`, `commentResolve` and `commentUnresolve` all
  exist in the schema. Editing rewrites what a colleague has already been notified about, which is why there
  is no verb; resolving is a genuine gap rather than a decision.
- **No label, no cycle, no triage, no sub-issue, no attachment-to-issue, no customer-request write.** Each is
  a real Linear mutation with no door verb. `initiative link` is the only relationship write besides
  `relation`.
- **Nothing is conversational.** An MCP tool is called by a model mid-turn with whatever arguments it
  inferred. Every verb here takes a complete, validated form and refuses a partial one, which is the point
  and also the cost: it is more work to call.
- **`attach upload` has no teardown.** `fileUploadDangerouslyDelete` is in the schema (check it with
  `slopweaver atlas linear read --id operation:mutation.fileUploadDangerouslyDelete --json`) and no verb
  calls it. Whether a personal API key may call it at all is UNTESTED — this work did not try, because a
  mutation Linear itself names "dangerously" is not one to probe against the real workspace on a hunch. So
  the standing fact is the narrow one: an asset this door uploads stays uploaded.

### Where the two are level

Filing an issue, editing one, commenting, creating and editing a project, filing a milestone, and posting a
project status update. Both surfaces do all of it; the difference is entirely in the guarantees above rather
than in the reach.
