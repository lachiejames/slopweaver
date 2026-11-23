# Profiling a gate, a lane or a verb — before it needs a ceiling

Part of [Toolchain](../toolchain.md).

```bash
slopweaver dev profile --gate named-object-params --cpu --record   # a gate, from dev lint's own registry
slopweaver dev profile --lane unit --cpu --interval 4000           # a vitest lane
slopweaver dev profile --verb -- catalog trees                     # any slopweaver verb
slopweaver dev profile --gate jsdoc-tags --check                   # exit non-zero on a heap regression
```

It spawns the subject under `--cpu-prof`/`--heap-prof` plus this repo's own `SLOPWEAVER_HEAP_PHASES` report,
folds every document the run wrote (`tsx` and `vitest` both spawn children, so there is never only one), and
prints post-GC live heap by phase, self CPU by module and sampled allocation by module against
`.baselines/perf-baseline.json`. **Post-GC live heap is the memory number throughout** — deterministic to
about a MiB, and the thing that actually decides whether a process dies under a ceiling; peak RSS is
deliberately not reported. **Only the heap half gates**: a shared runner's wall clock is not a measurement,
so wall time is printed and never fails a run.

**A gate is spawned the way `dev lint` spawns it**: its row's own `env`, plus a base. A diff gate with no
`SLOPWEAVER_COVERAGE_BASE_SHA` refuses at a fraction of its real cost, so a caller's exported base is kept
only when it is a full SHA, and otherwise the merge-base of HEAD and origin/main is handed over and printed,
as the seat lane does (no fetch-age bound: a stale base still measures the real comparison). A gate with an
unusable or unresolvable base is refused with the fix; a lane or verb runs on, saying a diff gate inside it
will refuse. **A subject that exits non-zero measured a failure**: its report prints, it is never recorded,
and the verb exits 1.

`src/perf` holds the pure half — the V8 document readers (`v8Profile.ts`), the phase-line parser
(`phaseLines.ts`), what a subject IS (`subject.ts`) and the baseline comparison (`baseline.ts`) — and
`src/cli/commands/dev/profile.ts` is the only part that spawns a process or touches a file.

Two edges worth knowing before the first run. **Idle is reported, not hidden**: MEASURED,
`--gate named-object-params --cpu` spent **67.0% of its samples idle**, so the busy split is what the table
ranks — `node_modules/typescript` at 56.1% of the work, and `open`/`stat`/`read` together at 28%, which is
what "I/O bound, not CPU bound" looks like at module resolution. And **a long subject needs `--interval`**:
that same 39.7 s run wrote an 86.7 MB `.cpuprofile` at V8's default 1000 µs, and a document past 100 MiB is
skipped with a line saying so rather than aborting the run that produced it. **A table
built over a skipped document says `PARTIAL` and how many went missing** — each skip is a whole subject
process whose time the shares below do not include, and re-sharing over what survived would otherwise
print 100% of a denominator the run never measured.
