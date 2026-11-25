# The owner's words from outside the fleet: dictations, Codex messages, and a dump restored

Part of [The local Supabase store](../store.md), beside
[the fleet's own state](./fleet-state-and-measurements.md), whose `owner_turn` holds the turns a supervisor seat
wrote down. This page covers the rest of what the owner said: what they dictated and what they typed into Codex, plus
the verb that loads an older store's turns back from a dump. Owner ruling: build the import and load the dump, with
selective restore as a useful feature.

## `owner_capture`: one row per thing the owner said, append-only

`src/store/schema/ownerCapture.ts`. The identity is `(source, source_id)`, every write is `DO NOTHING` on it, so a
re-import over an unchanged source writes nothing and one over a grown source writes only what is new. A key already
stored with a DIFFERENT body (a recording re-processed in its app) or a different instant or recorded field is refused by
name and that write is dropped whole, never kept quietly as the old capture (`driftedCaptures`, `src/store/fleet/ownerCaptureStore.ts`). The body is
stored as exact text with its sha-256 and byte length. Bytes that are not UTF-8, or that contain a NUL, are refused
by name and never cleaned up, the same rule `owner_turn` follows.

| `source`       | Read from                                                                | `source_id`          | Kept beside the body                                |
| -------------- | ------------------------------------------------------------------------ | -------------------- | --------------------------------------------------- |
| `superwhisper` | `<recordings>/<epoch>/meta.json`: its `result`, never the raw transcript | the folder's epoch   | the app it went into, the recording's length        |
| `codex`        | Codex's `state_5.sqlite` and `thread_history_1.sqlite`, opened read-only | the thread item's id | the thread, its surface (`cli`/`vscode`), its `cwd` |

**Only interactive Codex threads are the owner's.** An `exec` thread is the fleet's own Codex pass. Its ids are filtered
out before the history is queried, so an exec item's text never enters the process
(`src/store/fleet/codexMessageSource.ts` carries the measurement and its repro). A recording with no speech is
skipped and counted, not stored. **Each leg is all or nothing**, as the door and autonomy legs are: one record
it refuses means none of that leg's rows is written, and the report says `nothing written — N record(s) refused`.

## The two legs, and the one path rule

```bash
slopweaver store import-fleet --only dictations --only codex-messages --dry-run   # counts, opens no connection
slopweaver store import-fleet --only dictations --only codex-messages
```

**The leg is `dictations`, not one app's name.** The owner rules the verb must not be specific to Superwhisper,
because other people use other speech-to-text software. A dictations folder holds one `<epoch seconds>/meta.json`
per recording. That is Superwhisper's layout, and the only one read today. Another app's layout becomes a second
projector beside `src/store/fleet/superwhisperCapture.ts` and a second `source` value; the leg stays the same.

Both legs read OUTSIDE the state home, so `src/store/fleet/captureSources.ts` makes one decision for them. A flag
(`--dictations <dir>`, `--codex-home <dir>`) always wins. Without a flag, a source is read only
when the import runs against the default home `~/.slopweaver`: Superwhisper's own default directory, and
`$CODEX_HOME` or `~/.codex`. `~` is the ACCOUNT's home, never `$HOME`, so a pointed-elsewhere `$HOME` does not make
its own directory the default. A `--home` rehearsal or a test home reads neither, and the leg prints why. An empty
directory flag is refused, since it would read relative to the working directory. The rule
is the one Claude Code memory sync already follows. Both legs ride the nightly `store import-fleet`.

MEASURED on one install (repro: the dry run above): `dictations` 4,379 rows, 61 recordings with
no speech, 0 refused; `codex-messages` 713 rows across 458 interactive threads, 0 refused.

## Restoring turns from a dump: `store import-owner-turn-dump`

```bash
slopweaver store import-owner-turn-dump --from ~/keep/owner-tables.sql --dry-run   # parses and checks every row
slopweaver store import-owner-turn-dump --from ~/keep/owner-tables.sql
```

This verb reads a plain-format `pg_dump` and keeps only its `owner_turn` and `owner_turn_location` COPY
sections. Every other section is skipped unread. It writes through the same writer the `owner-turns` leg uses,
so a body already in the store is a no-op. **A restore fills gaps and never rewrites what the store holds**: a
body is keyed by its own sha-256, so one already stored is the same words; a location's `turn` and `family` are
what its path names, so a dump row under a stored key cannot disagree on them; and a location already stored keeps
its stored timestamps even where the dump's differ. That is deliberate rather than a refusal:
any store that has re-imported the same files since the dump was cut holds them under later
`first_imported_at` stamps, so refusing on a metadata difference would block exactly the overlap a restore meets. The report counts what
was new and says the store already held the rest. The CHECKS load all or nothing. If any check fails, nothing is
written, and every refusal is printed with its line number:

- a missing or unterminated section, or columns that are not the exact list;
- a field the COPY text format cannot decode, or bytes that are not exact UTF-8;
- a body whose recomputed sha-256 or byte length disagrees with its row;
- a location pointing at a body the dump does not carry;
- a timestamp outside `YYYY-MM-DD HH:MM:SS(.fff)+00`, or a family outside the known set;
- a location whose `turn` or `family` is not the one its own path names.

`src/store/ownerTurnDump/` is the domain: `copyText.ts` decodes one COPY line, `project.ts` folds the sections,
`read.ts` streams the file. MEASURED on one kept dump: 750 bodies at 30,128 locations, every row
checked (repro: the dry run above, pointed at that keep's `owner-tables.sql`).

## What does not read them yet: `talk recall`

`talk recall` hands its hits to the console voice on ChatGPT. Adding `owner_capture` there would send what the
owner dictated into any app, and what they pasted into Codex, to OpenAI. The ruling that built this table said
nothing goes anywhere new, so that egress is the owner's decision and is not wired in. Until they decide, the table is read by the
store, its backups and SQL.
