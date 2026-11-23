# The measurement, and what it covers

Part of [Why planning passes did not converge](../codex-plan-convergence.md).

Every pass writes `$SLOPWEAVER_HOME/orchestration/<id>/artifact.md` and the machine-readable `record.json`.
The 277 directories from before `record.json` existed carry only the artifact, so they were parsed from
its rendered `## Outcome` heading rather than skipped — which matters, because they are
the only evidence that the mode asymmetry predates the window `record.json` covers.

| window                     | source        | plan passes | plan concluded | review passes | review concluded |
| -------------------------- | ------------- | ----------- | -------------- | ------------- | ---------------- |
| before `record.json`       | `artifact.md` | 45          | 86.7%          | 232           | 97.8%            |
| since `record.json`        | `record.json` | 74          | 71.6%          | 343           | 94.5%            |
| **whole recorded history** | both          | **119**     | **77.3%**      | **575**       | **95.8%**        |

**The one-in-five figure reproduces.** Planning fails to conclude 22.7% of the time across the whole history
and 28.4% inside the `record.json` window. Review fails 4.2% of the time. The asymmetry is real, it is roughly
five-fold, and it holds in both windows independently.

Splitting the `record.json` window by reason is what localises it:

| mode   | n   | `off-track` | `no-conclusion-in-bound` | `fatal`   |
| ------ | --- | ----------- | ------------------------ | --------- |
| plan   | 74  | 17 (23.0%)  | 3 (4.1%)                 | 1 (1.4%)  |
| review | 343 | 7 (2.0%)    | 1 (0.3%)                 | 11 (3.2%) |

`off-track` is an **11-fold** difference between the arms and accounts for essentially all of planning's excess
failure. Everything else is comparable or better than review's. So the question was never "why does the brain
wander when planning" — it was "why does the tripwire fire eleven times more often on a planning pass".

## Why the tripwire fired: three independent misreadings

`assessPassActivity` aborts inside the first 60 seconds when a pass has ≥2 commands "searching outside the
workspace and the repo" AND ≥1 command that exited non-zero. Both halves were being supplied by ordinary work.

Across the 24 recorded `off-track` aborts, 23 fired that signature (the 24th read another pass's artifacts,
which is a correct abort). Their 58 pieces of stated path evidence break down as:

**1. A relative path read as an absolute one — 32 of 58 tokens.** The matcher was
`/\/[A-Za-z0-9._\-\/]+/g`, which matches any run beginning with a slash, including the tail of a relative
path. `rg --files -g 'src/lib/providerCall.ts'` produced the token `/lib/providerCall.ts`; a `find` under
`apps/ops/datadog/dashboards` produced `/infra/datadog/dashboards`. Both name files the pass was correctly
reading inside the repository it was pointed at. Real examples from the history, all counted as sweeps:
`/devLint/coverageRatchet.ts`, `/lib/gitRepo.ts`, `/retrieval/embeddings.ts`, `/cli/manifests`,
`/__tests__/`, `/rules/`, `/outbound`.

**2. The agent's own state directory — 15 of 24 aborts.** Every one of those named
`~/.codex/memories/MEMORY.md`. That is the Codex CLI's own memory file, read as it starts up, before the pass
has done anything. It is guaranteed to sit outside both roots, and because the read is usually an `rg` that
matches nothing it exits 1 — so **one file supplied both halves of the evidence** for a conclusion about the
pass's judgement.

**3. Tokens that were not paths at all.** `//` out of a `https://` literal in a search pattern.

**The failure half was equally thin.** The reason string reads "it missed and then began searching the
machine", but the gate is `failedCommands > 0`. Every recorded abort had one or two failures out of two to
eight commands, and `rg` exits 1 when it simply finds nothing. Not one abort fired the honest signature —
`every command has failed` — which is 0 of 24.

**Why this hit planning eleven times harder.** A review prompt supplies the diff as a file and says not to read
other files; a planning prompt tells the pass to investigate the repository. Measured on passes that
_succeeded_: a plan runs a median of 33 commands to a review's 16. Twice the path-bearing commands in the same
early window is twice the exposure to a matcher that misreads paths. The tripwire was not calibrated on the arm
it was hurting most.

## What closes it

`src/codex/tripwire.ts` requires an absolute-path token to begin at a genuine shell token boundary, ignores
the agent's own `/.codex/` state, and refuses `//`. The thresholds are untouched: two sweeps plus one failure
aborts, and a bare top-level sweep like `rg --files /w` is the strongest signal there is.

`outsideSweeps` does not trust a single reading of the line either. **A path is evidence only if it looks
outside under EVERY spelling of the command.** That rule came from the review arm judging this change — six
passes, nine counterexamples, all BROKEN. Seven were the one defect class; the eighth was a plain allowlist gap
that had been there all along (`/sbin` is as ordinary a tool directory as `/bin`); the ninth was a redundant
path segment.

The token character class is narrower than what a filesystem allows, so a root containing anything outside it
truncates or splits every token beneath it and an in-root read stops looking in-root. Two of those plus one
ordinary failed command is an abort. The sequence, and what each of my fixes actually bought:

| finding | counterexample                                                   | my fix                                        |
| ------- | ---------------------------------------------------------------- | --------------------------------------------- |
| 1       | `repoRoot = /repo+root`                                          | require a token to END at a terminator        |
| 2       | `repoRoot = /repo root`                                          | compare the roots at the match OFFSET         |
| 3       | `cat /repo\ root/…` — the shell escaped it                       | unescape the line before comparing            |
| 4       | `repoRoot = /repo\root` — a LITERAL backslash                    | accept EITHER spelling, raw or unescaped      |
| 5       | `repoRoot = /repo:/root` — a colon SPLITS it                     | ask whether the match starts INSIDE the root  |
| 6       | `cat /repo''\ root/a` — quoting, any spelling                    | keep only tokens EVERY spelling calls outside |
| 7       | `repoRoot = /repo:` — the split lands on the root's END boundary | an off-by-one in my own fix: `<=`, not `<`    |
| 8       | two `/sbin` tool invocations                                     | `/sbin/` was missing from the tool allowlist  |
| 9       | `cat /repo/./root/a` — a redundant path segment                  | resolve `.` and `..` before comparing         |

**This is the lesson, not a footnote.** Each of the first four fixes was another special case of the
mistake under repair — patching one root shape at a time — and each time a single rewording of a single
property exposed it. No tightening of the _pattern_ can close this class: whitespace, backslash and colon are all
legitimate path punctuation everywhere else, so excluding any of them to rescue one root shape breaks every other
line.

The last two are the ones that show the earlier fixes were the wrong SHAPE, not merely incomplete. A colon
splits a root and its tail matches at a LATER offset, so no test anchored at "does the root start here" could
ever see it. Quoting then defeated even the offset test, because the same path can be written four ways.

So the final rule stops reasoning about spelling at all: run the whole detection over each spelling of the line —
as written, with escapes collapsed, with quotes removed — and keep only the tokens they ALL call outside. A false
positive needs every spelling to agree, which the quoting family never does. A genuine sweep looks the same
however it is written, so it survives untouched: the historical 16-of-18 and the live 4→0 measurements below are
identical before and after this rule.

Finding 3 also flagged the converse, correctly: the ASCII-only class could not match a path whose components are
not ASCII, so an outside unicode path was never reported at all. That is a MISSED sweep rather than a false one,
which is this module's chosen failure direction — but choosing it for every non-English path was an accident
rather than a decision, so the class is `\p{L}\p{N}`.

Every counterexample is pinned as a test, each verified to fail when its own fix is reverted.

**What the heuristic cannot see, stated in the module rather than implied:** `~`, `$HOME`, `..`, a
symlink, a `cd` earlier in the line, a path assembled from a variable. Every one is a missed sweep, never a
false one. Nothing here should be read as a guarantee that a pass reading outside its roots gets caught.

## Proof, against passes that actually failed this way

Not a green suite — the failures are behavioural. Each recorded `off-track` abort was paired back to its own
heartbeat log by folding the log's real command lines and requiring the result to reproduce the record's stated
evidence exactly under the OLD matcher. 18 of the 24 could be paired that way (the rest have no surviving log).

**16 of those 18 do not abort under the fixed matcher.** They land on `suspect` — the failure signal was real and is not suppressed
— which means the pass runs on instead of being killed. The 2 that still abort are the orchestration-pry case
and one pass that genuinely read another session's scratchpad.

The two clearest, both pinned as tests in `src/__tests__/unit/codex/tripwire/ownRepositoryReads.test.ts`:

- an `r1` review killed at 58s after reading its packet in four slices, one `rg` that matched nothing, and two
  source files by relative path — `src/devLint/coverageRatchet.ts` and `src/lib/gitRepo.ts`, which were its
  two "sweeps";
- a `p2` plan killed at 41s whose two sweeps were `~/.codex/memories/MEMORY.md` and
  `src/devLint/boundaryResidue.ts`.

**And live, on this branch.** A `p1` pass was pointed at two files that do not exist — the misroute
shape the tripwire was built for — with a 180-second bound. It survived only because Codex happened to write
every probe defensively (`if [ -f … ]`, `|| true`), so nothing exited non-zero. Replaying its real first-minute
command lines through both matchers:

| matcher | "outside sweeps" in the first 60s                                                |
| ------- | -------------------------------------------------------------------------------- |
| old     | **4** — `/codex/AGENTS.md`, `/codex`, `/codex/progress.ts`, `/codex/tripwire.ts` |
| new     | **0**                                                                            |

Every one of those four is a fragment of a relative path to a file inside the repository the pass was pointed
at. Four is twice the abort threshold, so that pass was **one ordinary non-zero exit away from being killed
inside its first minute** — for reading its own source. The comparison understates it: the tripwire's real
`repoRoot` was the frozen snapshot path, so under the old matcher even the pass's absolute in-repo reads
counted as outside.
