# Import and export — the installation's owned state

`store backup` moves the whole database somewhere else. `store export` is narrower and portable: it carries
only the typed state an installation OWNS — what no provider can be asked for again — so it can be read back
into a different store, on a different machine, by a later build.

## What an export carries

Seven parts, each its own file at the export's root, each with its own `schemaVersion`:

| Part               | File                           | Read with                                                           |
| ------------------ | ------------------------------ | ------------------------------------------------------------------- |
| `memories`         | `memories.jsonl`               | the `knowledge restore --file` decoder                              |
| `memory-recalls`   | `memories.jsonl.recalls.jsonl` | the same decoder's recall half                                      |
| `owner-profile`    | `owner-profile.json`           | the profile's own schemas; `null` when unset                        |
| `owner-voice`      | `owner-voice.jsonl`            | the voice register's cohort parser                                  |
| `owner-directives` | `owner-directives.json`        | the directive overlay parser (v2)                                   |
| `standing-asks`    | `standing-asks.jsonl`          | the standing-ask fold, which must succeed; rows are the active asks |
| `steer-verdicts`   | `steer-kinds.jsonl`            | one strict envelope per measurement (v2); journal lines read as v1  |

The memory pair is byte-identical to what `knowledge export` writes, so `knowledge restore --file` reads it
directly. The owner profile travels WITHOUT its person link, revision and update time: each is local to one
store. Handovers, published pages, backlogs and the session-start cache are not parts — they have their own
owners, and the cache is rebuilt from the store.

## How an export is written

```bash
slopweaver store export --out <dir> [--home <dir>] [--json]
```

- The store parts are read in one read-only, repeatable-read transaction. `owner-directives` is the active
  versions of the `owner_directive` and `owner_correction` tables, read in that snapshot after the one-time
  import of a legacy `judgement/owner-directives.json` has run. `standing-asks` is every `standing_ask_event`
  row's exact line in journal order, read in the same snapshot after the one-time import of
  `judgement/standing-asks.jsonl`, so it holds the journal's identical nonblank event lines in order; a journal changed
  after that import refuses. `steer-verdicts` is one v2 envelope per `steer_measurement` row in `journal_seq`
  order, read in the same snapshot after the one-time import of `judgement/steer-kinds.jsonl` (below); a journal
  changed after that import refuses. Both journals'
  witness checks run again after the snapshot and once more after the directory is published, so one an old build
  appended to before that last check refuses too, and the export that run published is removed.
- Every part is written into a private sibling staging directory (`0700`, files `0600`), then RE-READ with the
  import's own reader, so an export the import would refuse is never published. The manifest is written
  last. The target is then claimed with an exclusive `mkdir` and the staging directory renamed onto that
  claim, so a target that exists, empty or not, is refused and never touched.
- What a path-based publish cannot close: a process that removes the claim and recreates it empty in the
  instant before the rename, and a kill between the claim and the rename, which leaves an empty `--out` the
  import refuses (it holds no manifest). Both need a process acting in the target's own parent directory.
  A kill during staging leaves the hidden `.<name>.partial-<uuid>` sibling, never anything at `--out`.

## The steer part's two versions

An export writes `steer-verdicts` at schema v2, one strict five-field envelope per measurement; a reader takes v1
journal lines or v2, whichever the manifest names. The envelope, its checks and the two residues of reading v1:
[steer-part.md](steer-part.md).

## How an import checks one

```bash
slopweaver store import --from <dir> [--approve <sha256:digest>] [--unmanifested] [--home <dir>] [--json]
```

Each part is opened once — a symlink or non-regular file refused before the open — and hashed, counted and
decoded from that one stream, then held to its manifest entry (bytes, then sha256, then rows). The report is
one line per part and one content digest; `--json` carries `"writes":0`. A manifest that lists a part twice,
omits one or points one anywhere but its own file name is refused.

A line that is not valid UTF-8 refuses the part, even where the part's own record reader would repair it to
U+FFFD and read on: the hash is of the bytes on disk, and a repaired line is not what the file holds. An export
written from the store is valid UTF-8 by construction, so a bad byte here is damage.

The directory is resolved to its real path once. Its identity and every file the read may open are
fingerprinted before and after the read, so a directory or part replaced or rewritten mid-read is refused
(`SOURCE_MOVED`). A replacement put back before the end goes unseen: Node opens by path,
with no `openat`, and only a process acting in the directory's own parent can do it.

`--unmanifested` reads a directory made before manifests: only the seven file names, nothing else in it,
and a part it lacks is reported `unavailable`, never as empty. It refuses a directory that HAS a manifest.

## How an import plans one against the live store

Once the export checks, the import reads the live store the way an export of it would (one repeatable-read
transaction, the journals bracketed by fingerprints) and decodes it with the SAME part decoders, so both sides
are reduced to one entry per logical row — a key, a `sha256:` fingerprint of its logical content and a
one-line summary — by one code path. Each part is then compared key by key:

| Part               | Key                               | Compared on                                                    | Role        |
| ------------------ | --------------------------------- | -------------------------------------------------------------- | ----------- |
| `memories`         | `recordingId`                     | every column the knowledge merge compares, instants by instant | record      |
| `memory-recalls`   | `recallId`                        | every column the recall merge compares                         | record      |
| `owner-profile`    | `owner`                           | its portable half                                              | record      |
| `owner-voice`      | `<surface>/<cohort>`              | the whole cohort                                               | record      |
| `owner-directives` | `directive:` / `correction:` + id | the whole directive or correction                              | instruction |
| `standing-asks`    | ask id                            | the active ask the journal folds to, not its events            | instruction |
| `steer-verdicts`   | event id                          | `exactText` and `sourceOrdinal`, every measurement its own row | measurement |

Every row is `new`, `identical` or `conflicting`; a row the live store holds and the export does not is
outside the plan, because an import never deletes. One side holding a key twice is refused (`DUPLICATE_KEY`).
Questions follow the rulings below: a new instruction gets an ACTIVATION question (`activate` |
`leave-inactive`), any conflicting row a CONFLICT question showing both summaries (`keep-current` |
`take-imported`), and a new record or measurement none. A conflicting row in an APPEND-ONLY part — `memories`,
`memory-recalls`, `steer-verdicts`, whose rows are never rewritten (`isAppendOnlyImportPart`,
`src/store/transfer/parts.ts`) — is asked as an ALIGNMENT instead, whose one answer is `keep-current`: the live
row stands whatever is answered, and the difference is reported. A summary is one line of at most 100 characters, a
control or format character shown as `�`; each side of a conflict carries `[content <hex>]` of its
fingerprint, 12 hex or longer where the two share that prefix, so the two lines always differ. A question's id
is `import-q-` and 16 hex over the comparison version, the export's content digest, its kind, part, key and both
fingerprints, so a re-run over the same export and store asks the same questions and two exports never share one;
the plan digest binds the comparison version, the content digest, every row's classification and imported payload
digest in key order, and the question ids. `--json` carries all of it under `plan` (its `comparisonVersion`
included), `"stage":null` and `"writes":0`. The comparison version (`STORE_IMPORT_COMPARISON_VERSION`,
`src/store/transfer/compare.ts`) moves whenever a rule change could reclassify a row or change a part's questions.
It is 5: version 2 brought the standing-ask card overlap below; version 3 keys each steer measurement by its event
id where version 2 kept only the folded readings still standing, by turn and kind; version 4 asks an append-only
part's difference as an alignment where version 3 asked a conflict no apply could honour; version 5 meets a memory
by its import key too and binds every imported payload into the plan digest. A new measurement asks nothing; an
event id the live store holds over a different line or ordinal is an alignment like any other append-only row's.

A standing ask is compared by its cards as well as its id (`src/store/transfer/standingCompare.ts`, since
comparison version 2). An imported ask that shares a card with a live ask under ANOTHER id is `conflicting`, never `new`. It
gets ONE conflict question, whose live line lists every live ask it meets, in id order, each naming why: `(same
id)`, `(shares <cards>)`, or both. That question's id binds each live ask's key, fingerprint and shared cards. `take-imported` there means
stopping every listed live ask, and `keep-current` changes nothing. An ask that meets no live ask gets an
activation question. One meeting only its own identical live ask asks nothing.

A memory is compared by its import key as well as its recording id, since the register holds both unique (since
comparison version 5): an imported memory the store does not hold under its id, whose import key a live memory
under another id holds, conflicts with that memory and is asked as an alignment, so the live memory stands.

A plan also names every NEED a row it writes has that nothing live or written provides (`src/store/transfer/closure.ts`):
a recall needs the recording and claim it counts; a superseding memory needs the claim it retires recorded under
its own kind and no other; a memory never supersedes its own claim. A row an alignment keeps out provides nothing
itself, so a recall of it is such a need unless a live row provides the same recording and claim. The plan prints each one (`N need(s) nothing live or written provides`), and
`applicationReadiness` (`src/store/transfer/importApplyPlan.ts`) refuses a batch whole on any
(`IMPORT_DEPENDENCY_UNMET`), so `store import --apply` refuses the batch whole rather than meet the register's
refusal part way ([applying](import-apply.md)).

## How an approved plan is staged, and its questions answered

```bash
slopweaver store import --from <dir> --approve <plan digest>
slopweaver store import-questions [--json]
slopweaver store import-resolve --question <import-q-id> --action <answer>
```

`--approve` re-plans and stages only when the plan made NOW carries exactly the digest named; a moved export
or live store refuses (`IMPORT_APPROVAL_MISMATCH`) and nothing is written. A plan made under another comparison
version is refused before a draft exists (`IMPORT_PLAN_STALE`), since the batch records this build's version and
would otherwise label another version's questions as this build's own. Staging is one transaction into four
store tables (`src/store/schema/importStaging.ts`): one `store_import_batch` per content digest, one
`store_import_item` per row with its whole decoded row as `payload`, so the directory can go away afterwards,
and one `store_import_question` per question. The export's content digest is unique, so staging the same export
again — even two stagings racing — writes nothing and reports the batch already there. A batch holding the
digest but not exactly that export's rows and questions under that plan and comparison version — a batch staged
before batches recorded one included, its `comparison_version` null — compared column for column with payloads
and summaries included (payloads by jsonb equality in the database, since a number past 2^53 decoded into
JavaScript reads as its neighbour), is refused (`IMPORT_BATCH_MISMATCH`), never trusted; one nobody answered can be removed whole and staged again. The check holds the batch row
`FOR SHARE`, so a removal racing it either finishes first and the export stages afresh, or waits for the check. `--json` carries the outcome under
`stage`, and `writes` counts the rows written.

Triggers keep what staging wrote: a batch takes rows only inside the transaction that staged it, no staged row
or answer is updated, an item or question is removed only with its whole batch, a batch holding an answer is
never removed, and none of the four tables is truncated. They guard every row-level route; the schema's owner
can still disable or drop a trigger, which no guard inside the database can refuse. The apply installs them
after the migration commits, so an apply that never finished leaves the tables unguarded until the next
`store push`: staging and answering check every trigger is there and enabled first, and refuse
(`IMPORT_GUARDS_MISSING`) rather than write into that state. Each trigger is `enable always`, so it fires for a
session in `session_replication_role = replica` too, which the store's own role may set; one reset to fire in
origin mode only counts as missing. Postgres's own foreign-key triggers do not fire in replica mode, so a batch's
removal would cascade to nothing there: no staging table is written in replica mode at all. Every guard function
runs on an empty `search_path` and names its tables `public.`, so a session's temporary table never shadows one,
and the apply names every function and table `public.` when it installs them, so no connection's `search_path`
puts a guard on a look-alike table elsewhere;
staging and answering set `search_path` to `pg_catalog, public, pg_temp` for their transaction, so a temporary
table of a staging table's name is searched last and never read or written in its place.

An answer is one `store_import_resolution` row, and a CHECK ties it to its question's kind: `activate` or
`leave-inactive` for an activation, `keep-current` or `take-imported` for a conflict, `keep-current` alone for
an alignment, which only acknowledges a difference the live row survives. An answer is never
changed: the same one again writes nothing, a different one is refused (`IMPORT_QUESTION_ALREADY_RESOLVED`),
and an id no batch staged is `IMPORT_QUESTION_NOT_STAGED`. `import-questions` lists only the unanswered ones
in a batch staged under this build's comparison version, each with one exact `import-resolve` command per
answer. A question in a batch staged under another version, or before batches recorded one, is never listed,
and answering it is refused (`IMPORT_QUESTION_STALE`) with the batch row held `FOR SHARE`, because this build
would not ask it: the export is staged again instead. The bot reads none of the four tables.

## How a staged batch is applied

`store import --apply <batch-id>` writes what the answers admit in ONE transaction with a receipt, or nothing;
a restored instruction left inactive lands inactive, an append-only difference keeps the live row and is
reported, and `--stop-on-conflict` refuses instead. Every refusal, its order and what each row writes:
[applying a staged import](import-apply.md).
