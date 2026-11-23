# Overlap nomination at write time

The write-time gate's contradiction check. It exists because three memories once named reviewers for the same
work, contradicted each other and contradicted canon, and nothing asked the question when any of them was
written. Whether two texts CONTRADICT is a reading task no token count settles, so the gate only ever says
"these share a subject" and the writer answers. The code is `src/memory/overlapNomination.ts` (pure) and
`src/memory/canonReader.ts` (the filesystem edge).

## What is compared

- **Subject text only** — stem, `name` and `description`, through the same `memorySubjectText` the hygiene
  duplicate and enforcement checks use. Bodies carry shared verbatim quotations, and every false overlap here
  is a refusal. The residue: a contradiction buried in two bodies under unrelated descriptions is not asked
  about.
- **Memories**: every other leaf in the corpus the write lands in, never the leaf's own prior copy.
- **Canon**: the always-on set of the repository holding the hook payload's `cwd` — its entry document,
  everything that `@`-imports, and every `.claude/rules/*.md` with no `paths:` — split at `## ` headings
  outside fences. A section's id is `<path> § <heading>`; the text above the first heading is the bare path.
  No `cwd`, or a `cwd` in no repository, means no canon half; the memory half still runs.

## Thresholds, and how to re-measure them

A memory is nominated at **three** shared rare tokens; a canon section at three **and** a 0.3 share of the
memory's distinctive vocabulary. Both constants carry their measurement beside them, and the repro is the
verb:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" memory overlaps --dir <memory-dir> --repo <checkout> [--json]
```

It prints, per leaf, exactly what the gate would ask if that leaf were written now. Run it before changing a
threshold, and quote its counts in the constant's comment.

## Answering

| Nominated | `supersedes`                                    | `compatible` |
| --------- | ----------------------------------------------- | ------------ |
| a memory  | this replaces it — delete it in the same pass   | both stand   |
| canon     | refused: change the canon instead of the memory | both stand   |

A memory is addressed by its `name`, or by its filename stem. A value other than the two words is a `schema`
finding in `memory check`, and the gate keeps asking. A `supersedes` whose target file is still in the corpus
is `superseded-still-present` until it is deleted or the answer becomes `compatible`.

## What it does not ask about

An overlap the file ALREADY carried unanswered before this write — the gate subtracts the prior text's
unanswered set, like every other write-time check, so rewriting an old memory does not open a backlog. It asks
again when a rewrite REMOVES an answer the file had. A write whose after-state cannot be rebuilt (an `Edit`
whose `old_string` is not in the file) gets the fragment-only checks and no overlap question.

The gate fails open per half: an unreadable corpus nominates no memory, an unreadable canon no section.
Hatch: `SLOPWEAVER_ALLOW_MEMORY_WRITE=1`, the same as the rest of the write-time gate.
