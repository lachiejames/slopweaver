# The whole-file-string class — why it took three weeks to name

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

How long it took to find that this was a problem is itself a finding, and this page is that finding. It sits here
rather than in the gate's own header because the finding is about how this repository FINDS defect classes, not
about JSON.

## What actually happened, by commit

The class — a payload whose size is set by data passing through one JS string — was found **nine separate
times over thirteen days**, and named as a class on none of them:

| Day | Instance                                                   | How it was found                         |
| --- | ---------------------------------------------------------- | ---------------------------------------- |
| 1   | the reader refused a corpus that fits                      | the verb refused, in the owner's hands   |
| 1   | the Slack crawl grew with the workspace                    | a 7h13m backfill climbed 4.39 → 5.15 GB  |
| 1   | the bronze reader + three `parseXRows` parsers             | the same refusal, traced one hop further |
| 6   | the bronze dedup index                                     | a Slack refresh could not write          |
| 6   | bronze compaction, both sides                              | the lifecycle verb would not run         |
| 7   | the lexical index build                                    | a perf pass                              |
| 7   | the Slack atlas skipped the compacted window               | an atlas came back short                 |
| 13  | `silver/graph/graph.json`, 282 MiB through one `stringify` | an RSS measurement, twelve days later    |
| 13  | the dense vector leg, 547,412 chunks in heap               | the same measurement                     |

**The third row's pull request is titled `finish the no-whole-file-string class`.** It exported `readJsonlLines` as
"the one way to read a data-scale `.jsonl`", deleted the three whole-file parsers it knew about, and said so. Six
more instances landed after it. The `graph.json` write it did not catch had shipped the **previous day** — it was
in the tree while the class was being declared finished.

## Why none of the nine found the class

Four mechanisms failed, and they failed in the same direction each time.

- **Every instance was found by a SYMPTOM, never by a reading of the code.** A refusal, a crash, an RSS
  curve, a verb that would not run. A symptom is per-instance by construction: it tells you which call site
  hurt today, and nothing at all about the one that will hurt in a fortnight. Eight of the nine rows above
  are a symptom; the ninth is a perf pass that went looking for one instance and found one.
- **The rule was written where nothing could enforce it.** "`readJsonlLines` is the only way any Slopweaver
  code may read a data-scale `.jsonl`" is a categorical, machine-checkable sentence, and it lived in a JSDoc
  block in `corpusStore.ts` — read by whoever opened that file, which is nobody writing a new ledger reader
  somewhere else. This repository already knows this: it is the same failure `no-nested-ternaries`,
  `epoch-arithmetic` and `hand-rolled-result` each exist to close, and each of those was also a rule in prose
  first. **A categorical rule that is not a gate is a rule that only binds the session that wrote it.**
- **"Finished" was asserted, never measured.** The "finish the class" pull request could have run the check its
  own commit message implies — one grep for a whole-file read of a `.jsonl` — and found the sites that took another
  twelve days. Nothing asked it to. `AGENTS.md`'s own doctrine already says to state a criterion rather than a
  count; a closure claim is a count of zero, and it deserves the same bar.
- **The handover board rewarded instances.** Each of the nine got its own row, its own doc, its own PR. The
  board is a register of work in flight and has no shape for "these five rows are one class" — so five
  correct, well-run rows added up to a class nobody owned. This is the cost of the thing the board is good
  at, not an argument against it.

## What would have surfaced it earlier, in order of how cheaply

1. **A gate written WITH the "finish the class" pull request, on day 1.** The criterion needed nothing that did
   not exist then: `readJsonlLines` had just landed, and "a `.jsonl` read whole" is a syntax-only check. It would
   have refused six of the nine on the day the seventh was fixed. This is the whole recommendation; everything
   below is a smaller version of it.
2. **A closure claim that has to name its criterion.** "Finish the class" in a commit message is unfalsifiable
   as written. "Finish the class: zero whole-file reads of a `.jsonl`, measured by `<command>`" is not, and
   the difference is one line.
3. **The board naming a class when a third instance arrives.** Two instances is a coincidence; three is a
   class, and the third row is the cheapest moment to notice — day 1, not day 13.

## A static gate could not have caught all nine, which is why there are two mechanisms

The gate alone leaves a hole, so the other half is a wrapper: a safe JSON stringify and parse that warns when the
data is massive and, a step further, throws, because there is never a legitimate case to stringify or parse
something over a certain size.

The hole was measurable within the hour. `src/atlas/atlasFile.ts` is the one seam every atlas artifact leaves
through, and on one install it had written a **169.2 MiB** `atlas/cloudflare/pages-project.json` — a tenth
instance of the class, which no run had named and which **the gate cannot see**: the file is `.json` rather than
`.jsonl` and the module reads no corpus, so none of the three static signals reaches it. Nothing static could have
reached it, either. The size is a property of one Cloudflare account, not of the code.

So the two mechanisms divide the class along the line that actually separates it. `whole-file-json` refuses
the shapes visible in the syntax; `safeJsonStringify` / `safeJsonParse` (`src/lib/safeJson.ts`) refuse the
size only visible at runtime. Neither subsumes the other, and the Cloudflare artifact is the proof.

**What that refusal then bought.** The runtime seam did what it is for: the Cloudflare atlas stopped writing rather
than writing 169 MiB through one string, and it STAYS refused until the write is fixed rather than the threshold
moved — fix the tooling first, then run the syncs once everything works without issue. The fix is the eleventh
instance handled as a CLASS instead of a site: every atlas kind file is a `<kind>.jsonl` — envelope on line 1, one
entity per line — written through `writeFileAtomicStream` and read through `readJsonlLines`, so no atlas's kind
file, on any tenant, ever passes through one JS string. Only `manifest.json` stays a whole document, because one
status cell per kind is bounded by the code rather than by the tenant.

**On the package question** — whether a battle-tested library with a hundred million weekly downloads already
does this — the survey is in `safeJson.ts`'s header and the answer is worth keeping: the high-download
`safe`-JSON packages exist and guard something else entirely (`fast-safe-stringify` 45.3M/week and
`json-stringify-safe` 41.8M/week guard circular references; `secure-json-parse` 35.8M/week guards prototype
poisoning). None takes a size. The streaming libraries (`stream-json`, `bfj`, `big-json`) are the fix once you are
over the line, not the guard that tells you that you are — and this repo already has its own streaming pair.
Twenty lines was what remained.

## A CLEAN gate is a measurement of the gate, not of the tree

The gate above shipped, went green, and was wrong about how much it could see. MEASURED: it recorded **9 of the
26** whole-file `.jsonl` reads standing in this tree and printed `whole-file-json: clean`. The cause was one word
in its own criterion — it indexed a path helper whose returned expression contained a `.jsonl` **literal**, and a
helper here almost never spells one. `askLifecyclePath()` returns `stateHomePaths(…).live.slack.asksJsonl`;
`queueLogPath()` returns `join(dir, QUEUE_FILE)`. The sharpest proof was one file read two ways: `turn/freeze.ts`
was recorded reading `asks.jsonl` because it spells the path as a property access, while the **listener's own hot
path** read the same file invisibly behind the helper.

Two things generalise, and neither is about JSON:

- **The number a tripwire prints is its own coverage, never the tree's.** `clean (9 recorded in DEBT)` reads
  as a fact about the repository and is a fact about the matcher. AGENTS.md rule 3 already says a gate's
  silence means nothing; this is what that looks like when the gate is the thing you wrote to stop guessing.
  Ask what a new gate MISSES on the day it lands — the same question that found the tenth instance above,
  applied to the instrument instead of the class.
- **A syntactic index that follows a name must run to a fixpoint, and must be stricter about what it ADMITS
  than about what it flags.** The gate re-judges every declaration against the names the previous round
  proved, until a round adds none (three rounds on this tree). The criterion for a SITE stays "mentions a
  `.jsonl` anywhere in the argument" — at the point of harm a wide net is the point — while the criterion for
  a DECLARATION is "resolves to a path". MEASURED: the loose criterion applied to declarations indexed 190 names
  including `readAskLifecycleText` and `productionBriefingRenderDeps`, because an index that feeds itself
  amplifies its own sloppiness every round; the strict one indexes 51, every one a helper that returns a path. The
  `jsonl-read-whole` DEBT went from 12 files to 29 — the predicted rough tripling, which is the number becoming
  honest rather than the tree getting worse.

## The rule this leaves behind

**When you fix the second instance of anything, the deliverable is the gate, not the fix.** Both, where the
fix is urgent — but shipping the fix alone is what produced the table above, nine times, by sessions that
were each doing careful, correct, well-measured work. And when the gate cannot see the whole class, say so
and add the runtime half rather than shipping the half you can prove: the tenth instance was found by asking
what the gate would MISS, which took minutes, having taken thirteen days to find the ninth by waiting for it
to break. The gate is `whole-file-json` (`src/devLint/wholeFileJson.ts`), the seam is `src/lib/safeJson.ts`,
and the rule prose for both is in
[typescript-patterns.md](../../.claude/rules/typescript-patterns.md) § Other rules.
