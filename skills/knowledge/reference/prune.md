# Pruning the register — the one verb that removes rows

Every other knowledge verb appends. `record`, `remember` and `recalled` never touch a row already written,
because a repeated claim id IS the consolidation signal. A claim found wrong mid-task is regraded with
`knowledge recalled … --outcome broke`, never removed.

`knowledge prune` exists for the other case: a hygiene pass the owner approved named claims that must leave
recall altogether — a row canon now carries, a mechanism that is gone, a duplicate folded into its keeper. The
first one ran on the owner's go for the whole memory-hygiene page, every action as proposed.
A prune without a reviewed pass behind it is not what this verb is for.

## Supersede first, prune only on a reviewed pass

A session that finds a claim REPLACED by a better one needs neither a pass nor a deletion: record the new
claim with `--supersedes <old id>`. The old claim leaves recall, `list` and the quiz the moment the new
recording lands, its rows stay, and recording it again later brings it back. It must name a claim of the same
kind, never a trace, and never its own id. Prune is for rows that must physically leave the table.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge prune --plan <plan.jsonl>           # dry run: what would leave
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge prune --plan <plan.jsonl> --apply   # archive, then one transaction
```

## The plan

One JSON object per line, two shapes:

```json
{"op":"retire","id":"l-…","reason":"canon carries it: skills/github/SKILL.md"}
{"op":"replace","replaces":"l-…","reason":"claim was false","row":{"kind":"lesson","domain":"…","claim":"…","evidence":"…","verdict":"confirmed","tier":3,"surface":"repo","learner":"fleet","run":"ad-hoc","repro":null,"caveat":null,"behaviourChange":"…","retrievalCue":"…"}}
```

- **Every retire says why it left.** The reason is archived with the row.
- **A replace writes a new recording and retires the old claim** — unless the rewrite kept the claim text,
  so the id is unchanged; then the new recording supersedes and the claim's history stays.
- **Facets follow the kind**: a lesson carries `tier` and `surface`, a trace `question` and `outcome`, a
  preference neither. The id is computed, never typed.
- **One bad line refuses the whole plan**, every refused line named. A claim id named twice is refused too
  (a plan built from judged batches carries a row judged twice more often than you expect), and so is a
  rewrite landing on an id the same plan retires.

## What `--apply` does, in order

1. Validates the plan, then reads every recording and recall of every retired claim.
2. Writes them to `$SLOPWEAVER_HOME/knowledge/pruned/<instant>.jsonl` in `knowledge export` format, with a
   `.recalls.jsonl` sibling and a copy of the plan — BEFORE anything is deleted.
3. In one transaction: inserts the replacements, then deletes exactly the recalls and recordings the archive
   holds, by their physical ids. A recording of a retired claim written after the archive read stays.

Take a full `knowledge export` beforehand anyway. `knowledge restore --merge` takes back a WHOLE file, every
row in it or none, so getting one row back is the archive line re-recorded with `knowledge record`/`remember`.
