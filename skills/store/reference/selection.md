# Selecting rows — the filter vocabulary both read verbs share

`store read` and `store cite` take the same flags and select the same rows; they differ only in what happens
to the rows afterwards. Every flag below applies to both.

## The three text filters — at most ONE per query

**`--search <terms>` narrows the SELECTION without changing the question**, and a naturally-phrased question
usually needs it: full text ANDs a question's content words, so _"what went wrong with staging deploys this
week"_ selects on `went`/`wrong`/`week` and misses the topic. The verb prints which terms it used — read
that line before concluding the store holds nothing.

**`--contains <literal>` is the one to reach for when the thing you are looking for is not a WORD.** It
matches literal characters through the trigram indexes, where `--search` matches stemmed words through the
tsvector, and the two select different rows from the same column: measured, `--contains U04`
returns a few hundred rows and `--search U04` returns none, because the tokeniser never sees a substring inside a
`<@U…>` mention, an email address or a URL path.

**`--like <pattern>`** takes your own `ILIKE` pattern, wildcards included, where `--contains` escapes them so
a literal `%` finds itself.

Naming two of the three is a refusal saying which does what. The verb names the one it ran on every
selection line, so a thin page says whether it was thin for the right reason.

## `--person` spans platforms

**`--person <name|handle|email>`** resolves against the store's own people, so one name reaches that human's
Slack member id, Linear UUID and GitHub login at once. A name nobody matches is a REFUSAL listing the
closest names the store holds, never an empty page — and a name that resolves with no rows says so in as
many words, because "nothing loaded for them" and "they said nothing" are different facts.

## The structured filters

`--source`, `--kind`, `--container`, `--since`/`--until`, `--channel`, `--repo`, `--team`, `--assignee`,
`--state`, `--visibility`, `--limit`. A query naming two sources' columns is refused before a connection
opens.

`store cite` adds `--json`; `store read` adds `--shard-chars <n>`, the per-shard budget a reader is handed.

## When the question is exact: scan bronze

"Every record containing X" is a literal scan, and the bronze files answer it whole: measured,
`rg -I -F --stats <absent term> ~/.slopweaver/corpus/bronze` read tens of gigabytes in seconds. Four traps, each
SILENT:

- **`grep` in a Claude Code shell is not grep.** The shell snapshot shadows `grep` and `rg` with embedded
  ugrep/ripgrep functions (`type grep` says so); a non-interactive `bash script.sh` never loads it and falls
  through to BSD grep — measured, 0.75 s typed against 112.9 s scripted, on the same warm files.
  Type `rg` explicitly, and time a scan the way it will be run.
- **There is no `rg` binary**, only the function, so `command rg` in a child script finds nothing and returns
  zero hits fast, looking like speed.
- **Pass `-I`**, or every line carries a `filename:` prefix and each JSON parse dies.
- **A `--` before the pattern ends option parsing**, so a later `--include=<glob>` becomes a file operand and
  every filter drops, warned only on stderr.

A scan gives no person resolution, no structured filter and no exclusions: bronze still holds the alert
traffic the store's denylist removes (`store exclusions`), so a raw count is not a store count.
