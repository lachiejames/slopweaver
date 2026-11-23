# What is here

Part of [The local Supabase store](../store.md).

| Path                          | What it is                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/store/schema/`           | the tables, one module per group                                                                            |
| `src/store/identity/`         | the pure matcher, the resolution ladder, and the member reconciler                                          |
| `src/store/profile/`          | the owner row, the per-person judgement column, and the disposition manifest                                |
| `src/context/`                | the always-loaded block a session start injects, and its last-known-good cache                              |
| `src/store/schema.ts`         | the barrel — the single source of truth `drizzle.config.ts` and every client read                           |
| `src/store/schema/rls.ts`     | the policies, declared where the tables are so they generate                                                |
| `src/store/declared.ts`       | what the barrel declares — tables, enums, policies — derived, never listed                                  |
| `src/store/policies.ts`       | the roles, extensions, grants and enum labels drizzle cannot generate                                       |
| `src/store/migrate.ts`        | the apply loop — roles, the migration, then the enum labels and guards                                      |
| `src/store/generate.ts`       | the `drizzle-kit generate` CLI call, run by `store push` and by the lint gate                               |
| `src/store/lifecycle.ts`      | push, verify, baseline, reset against a live database; `lifecycleCore.ts` and `lifecycleVerify.ts` are pure |
| `supabase/migrations/`        | generated DDL, applied by `slopweaver store push`; read from the INSTALLED tree                             |
| `src/store/project.ts`        | the pure bronze-to-row projection                                                                           |
| `src/store/bagReaders.ts`     | the typed readers that projection takes off a record's untyped `raw` and `attrs`                            |
| `src/store/slackColumns.ts`   | the Slack side row's reaction total, message timestamp and thread root                                      |
| `src/store/fleet/`            | the pure projections of the home's own records, and the writers behind them                                 |
| `src/store/ingestJsonl.ts`    | the bounded loader                                                                                          |
| `src/store/ingest.ts`         | the batch write it shares with `store load`, and the slice step it repeats                                  |
| `src/store/client.ts`         | the typed query layer: connections, name scope and the readers                                              |
| `src/store/predicates.ts`     | the pure filter and facet SQL those readers run                                                             |
| `src/store/query.ts`          | the query schema that refuses a typo before SQL sees it                                                     |
| `src/store/config.ts`         | where the database SELECTION comes from, and why remembering one is not guessing                            |
| `src/store/reading.ts`        | the bounded look at the store a routing brief takes                                                         |
| `src/store/ingestSource.ts`   | one whole SOURCE's bronze, in bronze read order                                                             |
| `src/store/resolveEdges.ts`   | the thread-edge pass: derive every parent key, then point it at the row it names                            |
| `src/store/contentRemoval.ts` | retire named identities whose bronze rows were superseded — `fathom share` only                             |

`slopweaver store push` is the one act from a schema edit to a database that matches it: it runs
`drizzle-kit generate`, applies everything pending, then reads the database back and refuses to call
itself done unless every declared table, policy, grant, enum label, extension and role is there ([§ "The
lifecycle"](lifecycle-and-schema.md)). Nothing DEFAULTS a database — `SLOPWEAVER_STORE_URL`, else the selection remembered at
`$SLOPWEAVER_HOME/secrets/store-url`, else a refusal naming both, because a tool that picks its own
database can run against the wrong one — and nothing reaches a database that is not on this machine. That is
the owner's hard rule, so the refusal of a non-loopback URL has no escape hatch. [§ "The history leg a bot turn actually reaches"](history-load-and-full-text.md) is
why remembering it is the whole point.

## Where the local stack is, and how to open Studio

**The local Supabase is `yarn store:start` run from this repo, nothing else.** It runs `slopweaver store start`,
which boots the stack and then locks it: the verbs' own login, written to `secrets/store-url`, becomes the only
Postgres login this Mac's connections can use ([the local lock](../../skills/store/reference/local-lock.md)). The stack comes up
without the Slopweaver schema, so a new store is then `slopweaver store push` ([apply gates](apply-and-migration-gates.md)).
**The `supabase` pin in `package.json` is the image pin too**: each CLI release embeds the tag of every
service image it pulls, and nothing under `supabase/` overrides one (a `supabase/.temp/*-version` file would).
Docker, the runtime that runs them, is the one prerequisite `yarn install` does not provide. Read the tags with
`strings node_modules/@supabase/cli-darwin-arm64/bin/supabase | grep '^FROM '` and compare
`docker ps --format '{{.Image}}'`. `supabase/config.toml` names the
project `slopweaver`, so every container is `supabase_<service>_slopweaver` (`docker ps`), and every port
sits in the **553xx** block that config declares rather than the CLI's 543xx defaults — `54323` is the port
Studio would have on a project that never set one, and nothing on this machine listens there.
`postgresql://127.0.0.1:55322/<database>` is that one stack's `[db]` port, not a second project or a plain
container: `slopweaver_small`, `bakeoff_proof` and `bakeoff_rebase_proof` are databases inside it,
beside `postgres` (`select datname from pg_database`). `yarn store:status` prints every URL.

| Service    | URL                      | Config key      |
| ---------- | ------------------------ | --------------- |
| Postgres   | `127.0.0.1:55322`        | `[db] port`     |
| API (Kong) | `http://127.0.0.1:55321` | `[api] port`    |
| Studio     | `http://127.0.0.1:55323` | `[studio] port` |

Mailpit (`[local_smtp]`, port `55324`) is off with Auth, and nothing listens there.

**Studio is OFF by default** — the lean stack below says why — so its URL answers nothing until it is turned
on. To open it: set `enabled = true` under `[studio]` in `supabase/config.toml`, then
`yarn store:stop && yarn store:start` (`stop` keeps every data volume; only `--no-backup` deletes them), and
open **http://127.0.0.1:55323** — it redirects to `/project/default`. Revert the flip before committing,
or the committed default changes. MEASURED on the running stack: the restart took 59 s, every
database above survived it, and Studio plus the `pg_meta` it pulls in cost 269 MiB
(`docker stats --no-stream`), well under the 1.00 GiB the four disabled services cost together.
