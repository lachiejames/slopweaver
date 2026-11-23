# Redacting the register

The codebase's own redaction tooling, applied to the knowledge register as an **opt-in**. Nothing about how a
row is ordinarily written changes; a writer that wants it passes `--redact`, and the stored register is
counted and rewritten by two verbs of its own.

```bash
slopweaver knowledge redaction-scan            # counts by kind and by column; exit 0 at zero, 1 otherwise
slopweaver knowledge redact                    # the dry run: what would change
slopweaver knowledge redact --apply            # rewrite in place, archiving every old row first
slopweaver knowledge restore --file <export> --redact [--merge]   # the batch is redacted before either mode
slopweaver knowledge record ... --redact       # likewise remember and trace
```

## What runs, in order

1. **The install's replacement map**, `$SLOPWEAVER_HOME/hygiene-replacements.tsv`: what a name BECOMES. It
   spells the names it replaces, so it is install state and never enters git. The format — three tab-separated
   columns, `literal`/`regex` plus `i` or `preserve-case`, rules top to bottom — is the header of
   `src/hygiene/replacementMap.ts`. An absent map is normal and every verb says so on stderr; an unreadable or
   malformed one is a refusal, never an empty map.
2. **The committed forbidden-identifier rules** (`src/hygiene/forbiddenIdentifiers.ts`), the same hashed rules
   the repository gate runs. They can only say THAT a span is a name, so every span still standing is masked:
   a provider location's workspace label becomes `example`, keeping the host readable; anything else becomes
   `redacted`. A row about a provider in general is untouched — that judgement is the rules', not this verb's.

## What it rewrites, and what it refuses

Prose columns are rewritten. A claim id is derived from its domain and claim, so a claim whose text changed
takes the id its redacted latest recording derives, and every `supersedes` and recall naming it moves with it —
the same coordinated move `knowledge domains --migrate` makes. Two claims landing on one id join one series and
are counted as a merge.

Refused, with nothing written: a hit in an `import_key` (a source digest the importer re-derives), a hit in a
claim reference whose claim is not in the batch, and a value masking cannot bring to zero. Every refusal names a
column and a count, never a row or the text.

## What `--apply` guarantees

One transaction holding both tables locked against writers: read, plan, archive every pre-rewrite row to
`$SLOPWEAVER_HOME/knowledge/redaction/pre-redaction-<instant>-<uuid>.jsonl` (and its `.recalls.jsonl`, both
`0600`, the `knowledge export` format so `knowledge restore` reads it back), update by physical id, re-scan. A
residue rolls the whole thing back. **No row is ever deleted.**

Every report is counts. A scan that printed what matched would be a second way to find the names it exists to
remove.
