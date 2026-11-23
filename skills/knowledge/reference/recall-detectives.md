# The recall wave — Haiku detectives read the register, not you

Recall is a VERB, and the reading is done by sub-agents so the worker's context stays clean.

Instead of the worker reading everything, it spawns a Haiku agent to find all the relevant memories — what to do
and what to avoid — so the token window of whoever is doing the work stays purer and the detectives give it only
what is relevant to the task.

## Running one

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge detect "<the task you are about to start>" \
  --term <word> --term <word> [--slots <n>] [--ask <channel>/<messageTs> | --out <dir>] [--json]
```

From a bot turn, pass `--ask`: the wave lands in that turn's record set and survives the session
([detective-lessons.md](detective-lessons.md#where-the-reports-land)).

It counts what the register holds per term, plans the wave, writes one brief per detective and prints where
each brief and report lives. **It spawns nothing** — rule 2 — so you spawn one sub-agent per brief with the
Agent tool, model `haiku`, in process and FLAT. A detective never spawns another.

## How the number is decided

Counted, never chosen, exactly as the store wave is sized (`src/detective/fanout.ts`):

- **One lead per term that matches something.** A term the register does not match is not a lead — there is
  nothing for that detective to read.
- **Plus ONE discovery detective, always.** Recall stems and has no synonyms, so a query for `tracing` never
  reaches a row that only says `spans`; the discovery lead asks in the words a row would have used. It is the
  WHOLE wave when nothing matched, which is honest where a confident silence would not be.
- **The ceiling is the visible session's own context**, shared with the store wave. `--slots` narrows it, and
  anything past the bound is reported as deferred rather than dropped.

## What comes back, and what you do with it

A report leads with what to DO and AVOID — gotchas, traps, and probes somebody already ran — each carrying
its claim id and whether the detective verified it. Read the reports yourself; the worker is still the one
that decides.

**Every report ends with an `## Accounting` section**: one `knowledge recalled` command per memory the
detective checked. Review them and run them ([traces.md](traces.md)). That accounting is what makes the next
recall worth running: held claims rank first, and a broken one regrades on the spot.

## The two limits that make a wave safe

- **A recalled memory is a hypothesis, never evidence**. The brief tells every detective to
  verify freeform — re-run the repro, read what the row names — and to report what it could not reach.
- **A remembered dead end NEVER skips a leg**. An empty trace reorders what the worker opens
  first and says what the emptiness did not prove. A detective that told the worker to skip a probe would be
  trading correctness for speed, and that trade has to be earned from the accounting data over several
  self-improvement loops — it is not available today.
