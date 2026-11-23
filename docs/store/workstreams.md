# Workstreams: rows, their own milestones, and one link table

The owner's ruling: workstreams live in the
store as a table with rows, not files. Each one carries **its own milestones**, the last of which is **its
definition of done**; a milestone is done only when a **dated entry links the proof**; and **one link table** ties a
workstream to the queue cards, alignment cards, automations, pull requests and Linear projects that are part of it.
The generic five-step bar (25/50/75/90/100) is not in this model at all.

Schema: `src/store/schema/workstreams.ts`, migration `0042`. The only reader and writer:
`src/workstreams/store/port.ts`, reached in production through `productionWorkstreamRegister()`
(`src/workstreams/store/register.ts`), which stands the tombstone fence (below) before every operation. Every
workstreams verb, the supervisor's coverage and `handover reconcile` read it there; nothing reads a file.

## The six tables

| Table                        | One row is                                   | Key                                                 |
| ---------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `workstream`                 | a workstream: the columns read by, `detail`  | `id` (lower kebab)                                  |
| `workstream_milestone`       | one of its own milestones, in authored order | `(workstream_id, id)`; position unique              |
| `workstream_milestone_after` | one "comes after" edge between two of them   | `(workstream_id, milestone_id, after_id)`           |
| `workstream_entry`           | one dated entry in its story                 | `id` (UUID); position unique per stream             |
| `workstream_link`            | one link to something it owns or bears on    | `id` (UUID); `(workstream_id, kind, target)` unique |
| `workstream_register_meta`   | the register-level document, a singleton     | `id = 'workstreams'`                                |

Every child carries `workstream_id`, and every reference to a milestone is the composite `(workstream_id,
milestone_id)`, so an edge, entry or link **cannot** name another workstream's milestone. The bot reads none of it
(`botRead: false`): rows quote colleagues and link internal threads.

The five enum columns (kind, workspace, status, entry kind, link kind) are built from the lists in
`src/workstreams/store/types.ts`, and the judge (`judge.ts`) refuses a value outside them as `WORKSTREAM_INVALID`
before Postgres sees it — so an outsider is an invalid write, never an outage, and the in-memory store refuses it too.
The same holds for an indexed text (a workstream, milestone or `after` id, a link target) longer than 256 characters
(`STORE_KEY_MAX_CHARACTERS`, `storable.ts`), which a B-tree index would otherwise refuse on insert. A count is never
bounded: every multi-row insert and `in (…)` list goes in runs of a thousand (`statementRuns`), under the wire
protocol's 65535 bind parameters per statement.

**`detail` is a document, decoded on every read and write** (`src/workstreams/store/decode.ts`, strict, per kind).
It holds the authored fields nothing queries by — people, priority, feedback, a linked workstream's gauge. Fields of
the retired bar (`reaches`, `lastStretch`, an authored `next`) are refused rather than carried.

## The definition of done, and progress

- The milestone with the **greatest position** is the definition of done, and every other milestone must lead to it
  through `after` edges — a milestone that leads nowhere is refused, because done would not wait on it.
- The graph is acyclic; edges stay inside the workstream (`src/workstreams/milestoneStructure.ts`).
- An entry finishing a milestone (`done`) names it and carries its proof link (a CHECK), and comes after an entry
  finishing each milestone it waits on, in entry order (the port).
- **Progress is derived, never stored** (`src/workstreams/store/derive.ts`): done is the set of finished milestones;
  ready is every incomplete one whose predecessors are all done, in authored order; next is the first of those. A
  tile reads `"<done> of <total> done, next: <name>"`, or `"<total> of <total> done"`. `local` and `closing`
  workstreams carry no milestones and no progress.

## The link grammar

Each kind names one canonical identity, so "which workstream is this in" is an exact match
(`src/workstreams/store/linkTarget.ts`):

| Kind             | Target                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| `queue_card`     | the board row's slug                                                    |
| `alignment_card` | the board row's slug                                                    |
| `automation`     | the automation's `recipeId`                                             |
| `pull_request`   | `owner/repo#N`                                                          |
| `linear_project` | the project's UUID, which survives a rename                             |
| `workstream`     | another workstream's id (the file register's `related`), why in `label` |

A `workstream` target is text, not a foreign key, so its existence is enforced under lock (below).

**The kinds are closed.** The file register's free `links: [{ href, label }]` has no destination: a link is one of
the kinds above or it is not a link. Nothing was lost at the cut, because no file register existed to carry over:
`slopweaver workstreams list` exited 3 on the old code, and the live home held no `workstreams/register.json`
when the verbs moved onto the store.

**The unit of write is one workstream, or one batch**, each compare-and-set on its revision. A verb that writes
several workstreams at once — a promotion linking two new ones, a delete with its linker, `workstreams put`'s whole
document (§ The verbs) — uses `applyBatch` (below), never a loop of puts.

The definition of done carries the stable milestone id `done` (`src/workstreams/store/doneMilestone.ts`): a promoted
candidate starts with it, named by the definition the owner picked or else the candidate's outcome; a redefinition renames
it in place and appends one note; a milestone placed under a workstream goes before it and `done` waits on it.

## Reads and writes

- **A read takes all six tables in one `read only`, `repeatable read` transaction.** A write replaces a workstream's
  children by delete-and-reinsert; a reader assembling across statements at the default isolation could otherwise see
  a parent from one revision and children from another. Every row is then judged exactly as a write would be, and a
  register that would be refused on write is `WORKSTREAM_STORED_INVALID` on read.
- **A write is one transaction, compare-and-set on `revision`.** It locks every `workstream` target `FOR KEY SHARE`
  in one statement ordered by id, refuses unless every target came back, then inserts (`ON CONFLICT DO NOTHING`) or
  updates `WHERE revision = expected`, replaces the children, and reads the aggregate back. A lost race is
  `WORKSTREAM_REVISION_CONFLICT`; nothing retries it.
- **A delete** locks the row `FOR UPDATE`, checks its revision, refuses with `WORKSTREAM_REFERENCED` while another
  workstream links to it, then deletes; children cascade. `FOR UPDATE` conflicts with `FOR KEY SHARE`, so a link and a
  delete racing each other serialise and one of them refuses.
- **A put reads back exactly as it returned.** Links carry no position and `after` is a set of edges, so the order a
  caller wrote them in cannot be recovered. The port writes every aggregate in one canonical order
  (`src/workstreams/store/canonical.ts`: milestones and entries by position, `after` by id, links by kind then
  target, by code unit) and assembly reads in the same order.
- **What the store cannot hold is a typed refusal, never an outage.** Validation refuses a position past the
  `integer` range, a stated revision no row could carry (fractional, below 1, past the range) on a put, a delete
  or the document, a write at the largest revision (its bump would overflow), year 0000, and any string (in `detail` too) carrying U+0000 or a lone surrogate
  (`src/workstreams/store/storable.ts`), because each would otherwise fail the insert or read back altered.
- **The register document** is its own compare-and-set: revision `null` creates it, a number updates it. Inside a
  batch it settles one of four ways (`src/workstreams/store/judge.ts`): revision `null` with no document asserts
  there is none, `null` with one creates it, a number with one updates it, a number with none deletes it. A batch
  stating `wholeRegister` must state the document too, so the compare covers the whole register.
- **A batch commits whole or not at all** (`src/workstreams/store/batchWrite.ts`): creates, updates, deletes and the
  document in one transaction. It locks every link target its writes name `FOR KEY SHARE` first, as a single write
  does, so a `remove` already holding its row finishes before the batch reads. Then it locks the `workstream` and
  register-document tables `SHARE ROW EXCLUSIVE` (a row
  lock would not stop an insert), reads every revision, and refuses unless an optional `wholeRegister` baseline equals it, every stated
  revision holds, and every `workstream` link names an id the batch LEAVES — so two new workstreams may link each
  other, and a link to one the batch deletes is refused. A delete still linked from a survivor is refused after the
  children are replaced. Every written aggregate is read back and decoded BEFORE the commit, so a read-back that
  does not decode is `WORKSTREAM_STORED_INVALID` with nothing kept. Any refusal after a write throws out of the
  transaction, so it rolls back.
- **A tombstone stands at the retired `workstreams/register.json`, and nothing imports a file**
  (`src/workstreams/store/retiredRegister.ts`). Before the store opens, the fence takes the old register's own lock
  key, installs a directory there holding only a `RETIRED` marker, and `fsync`s marker, directory, `workstreams` and
  home in that order, on every open; a failed sync is `WORKSTREAM_TOMBSTONE_NOT_DURABLE` and the store is not
  opened. A build from before the move then fails both its read and its staged rename against the directory, typed.
  Anything else at the path — the old file, a link, a directory holding more, a `RETIRED` that is not a regular
  file (never followed, and its sync opens with `O_NOFOLLOW`) — is
  `WORKSTREAM_RETIRED_REGISTER_PRESENT`: a person moves it aside and re-enters what it held.
- **A whole-register writer is fenced by content, not revisions** (`src/workstreams/store/baseline.ts`). A read's
  baseline is `wsb1.` and the sha256 of the authored register — the document and every aggregate in canonical
  order, keys sorted, with revisions, timestamps and progress left out — so a token from another store passes only
  where that store holds the same content. The writer compares it against a fresh read, then hands that read's
  revisions to `wholeRegister` and the document compare, so a change between the two refuses as well.
- **A store outage is `WORKSTREAM_STORE_UNAVAILABLE`**, never an empty register and never the retired file. A
  connection that fails to close turns a read into one, but never a write: by then the write has committed or rolled
  back, and its own answer says which. On a write it is INDETERMINATE: a connection lost while COMMIT is acknowledged
  leaves the write committed and unconfirmed, which no client can tell from a failure. Every refusal with any other
  code wrote nothing. So a writer reads again before deciding, and a blind retry is refused by its own stated
  revision, never applied twice.
- **An entry's or link's id is the caller's UUID, keyed `(workstream_id, id)`**, kept across rewrites. A writer
  mints a fresh one (`randomUUID()`) for each new entry or link. The key is composite on purpose: with a table-wide
  key, two writers that swapped ids between workstreams each waited on the other's uncommitted delete and deadlocked.
  Now a write only ever touches its own workstream's keys.

## The verbs

- **`workstreams list --json`** prints the schema-version-2 document (`src/workstreams/store/projection.ts`):
  `baseline`, `meta`, the `lanes` and `priorities`, the `people` roster joined for the chips, and each workstream
  as its aggregate plus a read-only `derived` block — lane, at risk, progress and its line, started and last moved,
  a linked one's gauge reading, the milestone graph. Exit 3 is an EMPTY register (no workstream and no document);
  a store refusal is exit 1, never an empty page.
- **`workstreams put --file`** takes that document back as ONE `applyBatch` (`src/workstreams/store/wholePut.ts`):
  fenced by the document's own baseline, writing only the workstreams whose authored content changed, deleting
  those it omits, settling `meta`. A document with no baseline is judged against the empty register's, so it can
  seed an empty store and never overwrite a populated one. It also refuses an entry or feedback link into a Slack
  conversation `meta.channels` does not name.
- **The candidate verbs** (`react`, `define`, `retitle`) append their ledger row first under
  `workstreams-ledgers`, then make one `applyBatch`; a promotion authors the `done` milestone.

## Proven against a real store

`src/__tests__/integration/workstreamStore.test.ts`, opt-in against a throwaway database (its header carries the
commands): the round trip, a put in scrambled order reading back as returned, the CHECK and composite foreign key, one winner of two creates and of two updates, the
cascade, a link refused when a delete took its target first, a delete refused when a link took the target first, two
writers linking the same targets without one waiting on the other's uncommitted lock, two writers swapping link ids while one is uncommitted, and a reader seeing the old aggregate while a replace-all is
uncommitted. For a batch (`src/__tests__/integration/workstreamStoreBatch.test.ts`, the same opt-in): a mixed batch with two new workstreams linking each other committing together; a stale
revision, a surviving link and a stale document each rolling back writes already made; a delete with its only linker;
a concurrent document write held until the batch commits; a batch waiting on a delete that locked its target first,
then refusing the link; and a batch waiting on a concurrent uncommitted create, then refusing a whole-register
baseline that no longer matches. The verbs themselves (`src/__tests__/integration/workstreamsVerbsRealStore.test.ts`, the same opt-in) through the
fenced production register: seeding, a list-edit-put keeping every child id, a stale document refused after another
client moved a workstream, the document or inserted one, a delete with the document cleared, and the store refusing
to open over a retired file. `src/__tests__/workstreamStoreFake.ts` is the in-memory store a verb test drives,
deciding through the same pure judges and handing out copies, as a database does.
