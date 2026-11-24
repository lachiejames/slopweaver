# The table browser — `store tables`, `store rows`, `store row`

Three read-only verbs over the store's whole public schema, the way a table editor reads it. The console's Store
page (`/store`) is built on them; a session uses them to look at a table it cannot reach through `store query`,
which answers only from the typed content model.

```bash
slopweaver store tables --json                                   # tables: columns, key, estimated rows, withheld count
slopweaver store rows --table-hex <token> --page-size 20 --json  # one page, primary key ascending by default
slopweaver store rows --table-hex <token> --sort-hex <token> --direction desc \
  --filter-column-hex <token> --filter-op contains --filter-value-hex <hex> --json
slopweaver store row --locator-hex <locator from store rows> --json
```

## Names travel as hex tokens

A table or column name is passed as the lowercase hex of its UTF-8 bytes — the `token` field `store tables`
prints beside every name. A filter value is hex too. So a name with a space, a quote or a leading dash, or a
value such as `--home /etc`, is never read as a flag. A token is never trusted: the verb decodes it and looks
the name up in the live catalog before it quotes a single identifier, and a filter value is only ever a bound
parameter.

## What each verb guarantees

- **Read-only, enforced by Postgres.** Every statement runs inside one repeatable-read transaction begun
  `READ ONLY`, whose first statement is `SET LOCAL statement_timeout` to 5 seconds — set there, not only on the
  connection, because a store URL's own `?statement_timeout=0` overrides a connection option. The verbs never
  call `connectStore`, which may apply the migration catch-up; they open one bare connection from
  `secrets/store-url`, the credential every store verb uses, and refuse a remote host the same way.
- **The read-only residue.** `READ ONLY` forbids writing persistent data, not temporary tables. A function
  already in the schema that a SELECT runs (a row-level security policy, a cast) could still fill a temporary
  table, which dies with the connection. Planting one is a schema write, so no reader-side guard is attempted.
- **Estimated counts, never `count(*)`.** `estimatedRows` is the larger of the planner's `reltuples` and the
  statistics collector's `n_live_tup`; `null` when neither exists. The page labels it estimated.
- **Stable pages.** The chosen sort comes first, then the whole primary key (or `tableoid` and `ctid` for a
  keyless table), and one row past the page is fetched so `hasNext` is measured, not guessed. The limit and
  offset are bound parameters, like every filter value.
- **Credentials masked in the verb.** Every value goes through the fail-closed masker the console's file views
  use (`src/talk/fileRedaction.ts`) with the private denylist; a cell where a credential survives is `withheld`
  with the reason. A database error's message goes through the same mask, since a cast can quote a value, and
  is withheld whole when a credential survives. An unreadable denylist refuses the read.
- **Names masked too, by leaving the table out.** A name is printed beside every value and its token is that
  name's hex, so a name cannot be masked in place. A table whose name, a column's name, a primary-key entry or a
  column's formatted type (which spells a user-defined type's name) the same mask would change, or whose token
  prints a denylisted string, is withheld whole: absent from `store tables`, counted in its `withheldTables` and never named, and `TABLE_UNKNOWN` to
  `store rows` and `store row`. The page says how many.
- **Cut, and said so.** A page shows 512 characters of each value; `store row` shows up to a million. A cut cell
  carries `truncated: true` and the stored length in `characters`. `bytea` is base64.
- **A row found again is the same row, and its locator holds no data.** Every row, keyed or not, reopens by
  `tableoid`, `ctid` and `xmin` together, so a row written since its page was read is `ROW_GONE` rather than
  another row in its place. Never by its primary key: a key is data, and hex in a locator would print it past the
  credential mask.

## Filters

`--filter-op` is `eq` (the value as text equals), `contains` (case-insensitive substring of the value as text,
`%` and `_` matched literally), `is-null` or `not-null`. A binary column takes only the null checks. The console's
Store page offers only the null checks and no table search, because the console takes typed words in the call's
chat alone; `eq` and `contains` are this verb's.

## Refusals

With `--json`, a refusal prints `{"error":{"code","message"}}` on stdout: a flag mistake exits 2, a read that did
not answer exits 1. The codes are `StoreBrowseError`'s (`src/store/browse/errors.ts`): `STORE_UNSELECTED`,
`QUERY_FAILED`, `QUERY_TIMED_OUT`, `CATALOG_MALFORMED`, `TABLE_UNKNOWN`, `COLUMN_UNKNOWN`, `FILTER_UNSUPPORTED`,
`LOCATOR_INVALID`, `ROW_GONE`, `DENYLIST_UNREADABLE`.

## Never paste what it prints

The rows are the owner's private data. A value read here stays on this machine: never in a commit, a test
fixture, a PR, a screenshot or a message. Tests use synthetic `acme` tables.
