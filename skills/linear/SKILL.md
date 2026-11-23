---
name: linear
description: Query the LOCAL Linear corpus by facet and have the cited page verified against live Linear, read one current Linear object, list a team's workflow states and members, list or create its issue and project labels, upload an image or video to Linear's own storage, or compose an issue, comment, issue relation, project, milestone, initiative, status update or document from a typed form whose exact markdown pure code emits. Use when the user asks what is assigned to them or to anyone in Linear, what is in a state, a team, a cycle, a project or an initiative, to inspect a current Linear issue, project or document, to look up a team's state ids or label ids, to label an issue or project, to put a screenshot in a Linear message, or to raise, update, comment on, link or post a status update on work through Slopweaver, to write a proposal or RFC as a Linear document, to join or leave a Linear team as the token's own user, or to move a set of issues into another team. Not for structuring or coaching an issue unless a provider operation is also requested.
argument-hint: query --assignee me [--state-type started]|read <id|url>|states --team <key>|issues --team <key>|labels --team <key>|label create --form <json|->|issue create|update --form <json|->|comment create --form <json|->|relation create --form <json|->|initiative create|update|link --form <json|->|initiative-update create --form <json|->|document create|update --form <json|-> [--document-id <id>]|attach upload --file <path>|team-membership join|leave --team <key> [--apply]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" linear $ARGUMENTS` and report the result.

Everything below is judgement the CLI cannot express. Read it before your first invocation.

## Ask a FACET question locally, and let the live check settle the citations

`linear query` is the verb for "what is assigned to me", "what is In Review on ENG", "what is in cycle 134" —
questions whose answer is a set, selected by fields rather than by words. It reads the LOCAL corpus, which
already holds every one of those fields, then asks live Linear one question about the page it is about to
cite: **are these still what we say they are.**

```bash
slopweaver linear query --assignee me --state-type started
slopweaver linear query --kind project --assignee me --limit 20 --json
slopweaver linear query --team ENG --state "In Review" --updated-since 14d
```

**The verification is the point, and it fires constantly.** Measured against the owner's own workspace,
a page of 20 tickets the corpus called `In Review` came back **10 confirmed, 10 changed** — every
one of the ten already `Done`. A row prints `[confirmed]`, `[changed]` with a `state: In Review → Done` line
under it, `[gone]`, or `[unverified]`. Quote a `changed` row's LIVE value, never its local one.

**Never read a `[changed]` or unchecked row as current.** With no Linear token the page still renders and says
`citations UNVERIFIED` in words; `--no-verify` says the same. Neither is the same claim as `confirmed`.

**This is not `linear search`.** That verb asks Linear's own search API for a TERM and is the right tool when
you are looking for words. Assignment, state, team, cycle and label are not words in a document, and a term
search cannot express them. Every facet, the closed sets each one accepts, why `--assignee me` can refuse, and
the request cost of the live leg are in [reference/querying.md](reference/querying.md).

## Read one current object

Use `linear read <identifier-or-url> --json` for one current issue, project or document. A bare `AIL-123`
means an issue; project and document reads need their Linear URL so the endpoint is unambiguous. The response
always names `readAtIso`, selected-field coverage and any connection with another provider page.
The reader can extract one unambiguous identifier or supported URL from a natural-language routing question.
Each selected activity connection defaults to 25 items; raise `--limit` deliberately, up to 100.

**`--pdf` carries what the object's files SAY, not where they are** — every `uploads.linear.app` URL in a
description, comment body or attachment node. The **bytes** decide what each is, since the asset path is
three UUIDs with no filename: a screen recording reads as not-a-document, a scan says it has no text layer
rather than rendering blank. An **off-host** attachment url is never fetched, because most are external
links and one would carry your Linear key elsewhere. **Nothing about one file ends the read** — a 401 or
unparseable bytes is a line in the block and in `residue`, and the object still comes back whole.

This is not workspace search. Use the local world model for historical discovery or rationale; whenever the
answer depends on current status, read the named object live before claiming it. Do not replace a refused
address with raw GraphQL or a second Linear client.

## State ids and assignees come from `linear states`, never from the world model

`slopweaver linear states --team <key>` reads one team's workflow states and assignable members LIVE, prints
every id in full, and RECORDS what it saw. That recording is what `linear issue` then insists on: a `stateId`
the read verb has never produced is **refused**, not sent.

That is not belt-and-braces. Before this verb the only visible source of a state id was the local corpus, and
the ingest redaction pass carves a UUID whose final group holds nine or more consecutive digits into
`…-956b-[number]efe` — a small fraction of a percent of distinct ids in a measured store, never zero. A mangled id still LOOKS like an id.
So: run `linear states`, copy an id it printed, and never lift one out of a corpus record.

`--no-record` prints the read without moving what the write door will accept. `--team` takes the key you
already see in every issue identifier (the `ENG` in `ENG-42`), because the team UUID is exactly the thing you
do not have. **Label ids come from `linear labels --team <key>`** the same way, and an agreed label that is
missing is ADDED with `linear label create`, never written into a fold instead: [labels](reference/labels.md).
**`linear issues --team <key>|--project <id>`** lists EVERY issue live, archived included, complete or refused: [querying](reference/querying.md); **`linear move-issues --to <key> --identifier <ids>`** moves a named set, previewed unless `--apply`: [updating](reference/updating.md).

## Assign by PERSON, not by user id

`fields.assignee` is a roster KEY — a canonical person id, a Linear user id, a Linear handle, `@handle`, or
the email on their Linear identity. It resolves against the confirmed identity roster, **exact match only**,
and an unresolvable key is refused rather than guessed. Assigning the wrong colleague puts work in their queue
and their face on someone else's problem, so this is the same bar mentions are held to — literally the same
index, `src/outbound/linear/personIndex.ts`.

The resolved id is also checked against the destination team's recorded membership, when `linear states` has
read it. `--dry-run` shows you what the key resolves to today — and says "does not resolve YET" rather than
refusing, because the live run refreshes the roster first and someone who joined last week may resolve then.

## Comments and relations

**`linear comment create --form <json|->`** posts one comment on an issue, or on a DOCUMENT (an RFC) with
`{ documentId, quotedText? | parentId? }` — inline at a passage the document holds now, or a REPLY under the
thread root `parentId` names (`linear read <url> --include comments` lists them). Rule 7 is structural: `summary` is the message above the fold (≤50 words), `detail` and
`evidence` fold, and **an issue comment's `evidence` is required** — a document comment's quote is its
provenance. The id derives from destination plus body, so the same words cannot post twice. Filled shapes:
[reference/the-form.md](reference/the-form.md).

## Mentioning a person

Write **`@{key}`** in any prose field and the door resolves it against the same roster an assignee resolves
against, emitting **Linear's own markup, `@[handle](<linear-user-id>)`**, which is what notifies the person.
A `code` block is left alone. `key` is a roster key — a canonical person id, a Linear user id, a Linear
handle, `@handle`, or the email on their Linear identity — **or a NAME the member index resolves**, which
answers only when exactly one live colleague at your own email domain matches at the strongest tier reached.

**A key that resolves nowhere REFUSES the whole write**, naming the candidates with their user ids, and
**hand-written `@[name](id)` is REFUSED** everywhere prose is checked — an id is unreadable, so a transposed
one notifies the wrong colleague and looks perfect in review. The refusal's exact shape, the `--mention-id`
escape, and `relation create`: [reference/mentions.md](reference/mentions.md).

## What actually happens when you run it

`parse → validate → render → [--dry-run stops here] → token → ownership → door → reserve → mutate → read
back → confirm → report`.

A dry run performs **no effect at all**: no token resolved, no door record, no ledger entry, no network. A
live run reports the real identifier and URL, and only after reading the issue back — `issueCreate` can
answer `success: true` with a null issue, so its own response is not proof.

Three outcomes are worth recognising, because two of them are the verb working rather than failing:

- **`created AAA-12` / `updated AAA-12`** — done, and verified by read-back.
- **`refused: this exact intent was already reserved…`** — the at-most-once guard. The issue id is derived
  from the content, so an identical form maps to the identical issue and a retry cannot file a second one.
- **`… was created but could NOT be read back`** — the mutation landed and nothing could verify it.
  **Do not re-run it.** Look at the issue, then reconcile.

## You fill a form. Code emits the bytes.

Never hand-write a Linear description. Fill the typed form and let the renderer produce the markdown — that
is the whole design, and it is what makes the output byte-stable and the malformed cases unrepresentable.
Two kinds, discriminated on `kind`: **`structured`** is the default and what you should reach for, because
the sections ARE fields, so you cannot emit a heading and cannot get the order wrong; **`freeform`** is the
escape hatch for a ticket that genuinely does not fit, and it may NOT re-create `Problem` / `Solution` /
`Acceptance criteria`, because impersonating the structured shape while skipping its guarantees is worse than
either option honestly. **Media is positional** — a section is an ordered array of blocks and an image
belongs where you put it, which is why Linear does not share Slack's flat attachment bag.

What the form refuses is **structure only, in the SCHEMA** — Slopweaver supplies the shape, you supply the
words. **Above the fold is the exception, and it is a separate gate at the door**: `## Problem` (with
`proofOfProblem`), `## Solution` and a comment's `summary` go through the operator's exact voice rules plus
the packing rules, refusing rather than trimming, with the `voice-rules` hatch the one deliberate
exception. **Never write a bare PR number or ticket key — always a link**; `#<n>` and `ABC-<n>` resolve
automatically where unambiguous and are REFUSED rather than sent bare where not
(the `bare-refs` hatch is the break-glass). The kinds, the block vocabulary, the `details` folds a long
proposal's detail goes in and every structural refusal are in [reference/the-form.md](reference/the-form.md).

## `update` means replace, and that is a real constraint

Linear's update is patch-shaped; this form is complete-shaped. The stored markdown cannot be turned back into
a form, so `update` can only mean **replace the description from an authoritative form you supply** — never
"recover the issue and edit one field", which would silently overwrite whatever someone changed in between.
A body-replacing update therefore touches only issues slopweaver created and refuses when the description has
changed since. **`--fields-only` is outside both guards, deliberately** (owner ruling): it sends
neither `description` nor `title`, so it provably cannot reach a word anybody wrote, and it works on **any**
issue — which is what a cycle-hygiene close list is made of.

**An obvious edit on Acme work is taken `--unasked`** (rule 10): closure, assignee and mention
refused, recorded, rollback its activity history; `--rewrite-filed`, `--move-team`; never for tooling. **`null`
clears a field**, project and estimate included, and **a team the install retired is refused**: [updating](reference/updating.md). **`linear team-membership`**: [membership](reference/team-membership.md).

## A project UPDATE is not a project update

**`linear project update`** EDITS the project; **`linear project-update create`** posts the **status report**
everyone watching is notified of, and whose absence makes a project look abandoned. Linear's own API has the
same collision, so renaming either here would put this surface at odds with every provider document you might
check. **`health` is required** — `onTrack`/`atRisk`/`offTrack` — because a report posted without one leaves
the project reading whatever it read before, which is the silent staleness the verb exists to end. It is
create-only, like a comment and for the same reason. Details:
[reference/project-updates.md](reference/project-updates.md).

**`linear initiative` and `linear initiative-update` are the same pair one layer up**, against the identical
provider collision, and an initiative's `status` is a closed five-value enum where a project's is opaque.
**`linear attach upload --file <path>`** puts a local image, video or PDF in Linear's own storage and prints
the `media` block that embeds it — no browser and no cookies, unlike `github attach`. Both:
[reference/initiatives-and-images.md](reference/initiatives-and-images.md). **`linear document create|update`**
writes a proposal or RFC as a Linear PAGE in the issue's freeform blocks: [documents](reference/documents.md).

## Habits

- **Push updates into Linear EARLY, and name the uncertainty** — in a project update, an
  issue comment, a project description, anywhere: say what is known now and what is not, never wait for certainty.
  The daily [linear briefing](../automation/reference/linear-briefing.md) proposes each such write for the owner's yes.
- **`--dry-run` first.** Read the bytes before you file anything; a create is not reversible in any way
  that matters, since a deleted Linear issue sits in Recently Deleted for 30 days.
- **Leave `priority`, `estimate`, `stateId` and `assignee` unset** unless you actually know them: a ticket
  landing in triage to be sized and picked up is the product working normally, not an incomplete write.
- **Do not guess an `estimate` value.** The scale is per-team (`notUsed`, `exponential`, `fibonacci`, `linear`,
  `tShirt`), so a number valid for one team is invalid for another. Priority is global 0-4.
- **Acceptance criteria: 1 to 10.** A complex ticket needs ten; twenty-five is a dumping ground.
- **`proofOfProblem` is for proving the problem is real** — people raise suspected issues that turn out not
  to be, and someone else loses a day. It is NOT the proof-of-work artefact that belongs in the AI prompt.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.

For writes, fill the typed form, dry-run it, inspect the rendered bytes and use the same bundled CLI. Never
hand-write final Linear markdown, call raw GraphQL, use a provider MCP tool or hide a second Linear client in
another host repository. The world model is bounded history: useful for rationale and discovery, never a
replacement for a current read.
