# The supervisor's own model is not everything's model

This chat is the one chat that runs Fable, because it orchestrates twenty-odd others. Nothing it spawns
inherits that. The rule — pin a model on every dispatch call, and `cmux spawn` refuses one that does not —
is in [SKILL.md](../SKILL.md); this page is the table, the mechanism and the measurement behind it.

**The model you pin also picks the PLAN that pays for it.** A Fable spawn spends a budget Opus and Sonnet
spawns do not touch, and `cmux spawn` routes on that automatically — [plan-routing.md](plan-routing.md). This
chat's own Fable week is the one budget whose wall stops everything, so `claude gauge` and the briefing say it
with a `CHAIR —` line, naming the plan to hand the chair to, before it is capped.

**Why the `Agent` call is the leak, specifically.** The owner may run this chat on any model the owner chooses, and what
the rule owns is keeping that choice scoped to this one chat. A `cmux spawn` cannot leak it — `--model` is
REQUIRED there. An in-process `Agent` call can: omit `model` and it inherits the CALLING session's tier, so a
supervisor on an expensive tier silently pushes that tier onto every fan-out it makes. If a dispatch is about to
go out with no explicit `model`, stop and pin one.

## The per-role table

| Role                                                                  | Model                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The pinned supervisor loop chat                                       | Fable while two or more Claude plans stand; Opus on one; none valid on zero      |
| A spawn that rebases, resolves conflicts, lands a PR, or investigates | `--model opus`, which `cmux spawn` boots at `--effort high` unless one is named  |
| A spawn doing a mechanical leaf (a rename, a fixture, a doc edit)     | `--model sonnet`                                                                 |
| A deep investigation — a Datadog dig, a connection-pool exhaustion    | `--model fable`, roughly one spawn in twenty, under `ALLOW_FABLE_OVERRIDE=1`     |
| An in-process `Agent` call for a cheap status fan-out                 | `model: "haiku"`, explicit                                                       |
| An in-process `Agent` call for research or a sub-task                 | `model: "sonnet"` (or the tier the task needs), explicit                         |
| `subagent_type: "fork"`                                               | inherits by design — supervisor-grade reasoning only, never cheap leaf work      |
| A session `automation seat` opens for a due row                       | the seating pass names it: `automation seat --model <name>`, required            |
| The loop's respawned successor                                        | pinned in code: opus, no `--driver`; `high` on claude (`session/respawnBoot.ts`) |
| A Slack ask worker, its reviewer, a drawdown investigation            | pinned in code: opus at `--effort high` (`cmux/modelPin.ts`), sonnet bare        |

The supervisor spins up the right model for the job: a mix of Sonnet and Opus, and Fable very sparingly, for things
like deep Datadog investigations or connection pool exhaustion. About one in twenty of the sessions the fleet spawns
should be Fable; lean more on Sonnet and Opus. The opus/sonnet split above is a good heuristic, and the bigger
failure was the other stuff below.

The model is one lever; the **launch template** is its sibling. A spawn that will never edit code — a
Datadog dig, a Slack investigation, a doc read — names `--template research` (or its doc says `template:`),
and boots without the three code-standards rules: about 15k tokens a seat, measured
([the always-on set](../../../docs/doctrine-rationale/always-on.md)). An omitted template is the
role's own, so a workstream seat stays `code`. `slopweaver cmux templates` prints what each one loads.

## Which model id a tier lands on

**Every tier runs its NEWEST model id**, never an older, cheaper, lower-quality one pinned to save plan usage. Tier is the lever
(rule 5); version is not. So a spawn names the ALIAS, never a dated id, because the alias is what Claude Code keeps current: on 2.1.280
`opus` lands on `claude-opus-5-5` and `fable` on `claude-fable-5-1`, while a 2.1.278 boot still lands
`opus` on `claude-opus-5`. Every `cmux spawn` boots whatever `claude` is on PATH, so a fresh seat is on
the newest installed version and a long-lived seat stays on the model it was seated with until its
successor boots. The chair is that long-lived seat: its transcript records the version it runs, and `tick-record`
calls for a hand-off once PATH boots a newer one ([plan-routing.md](plan-routing.md) § The chair's hand-off cadence). An id pin would strand a host whose Claude Code does not know it. Opus 5.5 is also the
cheaper Opus ($4/$20 per MTok against Opus 5's $5/$25), so `session depth` weighs it on its own row
(`src/sessions/modelWeight.ts`). Read what each live seat actually runs (neither verb reads effort):

```bash
slopweaver session depth            # "deep on <model id>" per live seat
slopweaver session fallbacks        # any seat a safeguard moved off its seated model
```

## The other stuff: an omitted `--model` inherited Fable

**Measured** (`~/.slopweaver/evidence/token-usage-audit-03sep.md`): `~/.claude/settings.json` had
carried `model: fable[1m]` for a day. `cmux spawn`'s `--model` was optional and its absence only
warned, so every spawn booted onto that default — 22 of 26 live sessions on Fable, 48% of the day's list-price
spend at twice Opus's rate, three accounts' session limits gone in eighteen hours. The opus-versus-sonnet
split was never the defect; the silent inheritance was.

**The mechanism** (`src/cmux/modelPin.ts`, printed by `cli/commands/cmux/run.ts` before
any worktree or workspace effect):

- `slopweaver cmux spawn <slug>` with no `--model` REFUSES. There is no default to fall back to.
- `--model fable` REFUSES, saying to use the right tool for the job and, where Fable is the right one, to re-run with
  `ALLOW_FABLE_OVERRIDE=1 slopweaver cmux spawn <slug> --model fable`. The variable is read from the spawning
  process's own environment.
- A doc whose `statusSummary:` names a tier the spawn did not pin gets an ADVISORY, not a refusal — prose is
  advice the supervisor may overrule today.

The purpose is to make the path of least resistance one that cannot repeat this mistake.

## What holds beside the pin

- **Boot-time only, for a CHANGE.** `--model` is passed verbatim to `claude --model` on the boot line and
  nowhere else. Never send `/model` to a running session to move it onto a different tier: **don't switch models on
  existing sessions, it will mess things up.** Verify a live session's tier from
  `slopweaver session depth`, never by asking it.
- **A RESTORE is the one exception, and it is the opposite act.** The chair switches back by itself,
  with no hand needed from the owner, since the fallbacks seen have only been false positives. When an Anthropic safeguard fallback takes a seat off the model
  it was SEATED with, putting it back is not a tier change and the rule above does not reach it. The chair
  does this to its own tab (`src/supervisor/chairRestore.ts`, at most twice per trip, then the handoff), and
  nothing else in the fleet sends `/model` anywhere. MEASURED: a `cmux send` of `/model <tier>`
  flips a RUNNING session mid-turn and leaves no transcript record, because Claude Code consumes it locally —
  which is also why it cannot be mistaken for the owner's own words in the owner's box.
- **The chair's model follows its plans, and the lane switch is the restore's second use.** The owner's
  ruling: fill capacity while the plans last, save it on the last one. `src/supervisor/chairPolicy.ts` reads the
  Claude lane (`src/plans/laneShape.ts`, printed by `plans list`): two or more standing plans require Fable and a
  timer sweep; exactly one requires Opus with NO timer sweep (`sweep-prompt` exits 3 and the chair wakes on the
  owner's turn or a seat's message); none refuses every Claude chair. An unreadable register or a lane with no
  row keeps Fable. Under lean a Fable chair refuses and the restore types `/model opus`; the hatch is still
  `off-fable-chair`. With both lanes recorded lean, the idle-capacity gate stops refusing an idle tick.
- **A fallback is not Fable-specific.** `slopweaver session fallbacks` reports every live seat a safeguard
  moved off its seated model, of any tier — `claude-opus-5` to `claude-opus-4-8` is a measured
  non-chair case. The chair gate asks the chair two things: is it on its required model, and is it spending a metered Console
  organisation (`src/supervisor/chairMetered.ts`, off the telemetry). When cmux does not answer (a timeout or no socket; an error reply still refuses), the
  pinned workspace cannot be walked, so it judges the CALLING session's own transcript instead and passes an
  on-Fable one the supervisor-pin record names, saying the other tabs went unseen; any other caller still refuses
  (`src/supervisor/chairGate.ts`, which once hung a handoff for four hours).
- **The ledger records the pin.** A `spawned` row carries `pinned`/`inherited`; `slopweaver session list`
  prints `model=…`. An `inherited` row means the tier was UNKNOWN; a spawn cannot write one.
- **The `Agent` leak.** A call from this chat that omits `model` inherits this chat's — Fable. Pin every
  fan-out explicitly, per the table. Codex planning and review calls are separate infra and unaffected.

If a dispatch call in this chat is about to go out without an explicit `model`, stop and pin one. That single
habit, plus a spawn verb that refuses, is the whole guardrail.

## The second per-job knob: `--effort`

`slopweaver cmux spawn <slug> --model <tier> --effort low|medium|high|xhigh|max` pins how hard the seat
thinks, passed verbatim to `claude --effort` on the same boot line and nowhere else, so everything above about
boot-time-only applies to it.

**It is OPTIONAL, and that asymmetry is deliberate rather than an oversight.** An absent `--model` inherited
a saved default, which is the failure this whole page exists for. An absent `--effort` is DEFAULTED at the
door instead: `cmux spawn --model opus` on the claude driver boots at `high` and prints that it did
(`defaultSpawnEffort`, `src/cli/commands/cmux/spawnPins.ts`), and every other model boots on Claude Code's
own default, with no `--effort` on its boot line. A named level always wins, so a leaf can ask for `low`.

**A `--driver codex` spawn REFUSES an `--effort` rather than dropping it.** Codex boots as `codex
--no-alt-screen` and has no equivalent flag, so accepting the level would report a successful spawn to a
supervisor who believes a knob was set.

**Why it exists** (measured on the capacity page): 30% of every output token the fleet
produced in a day, 2.71M of 8.92M, was thinking — and a mechanical leaf and an incident investigation
thought equally hard, because nothing could tell them apart. Right-sizing effort is the same judgement as
right-sizing the tier: Opus at `high` for work that rebases, resolves conflicts, lands or investigates;
`low` for a mechanical leaf that already knows what it is doing.

**An Opus 5.5 seat with no `--effort` ran at `medium`, even under a saved `effortLevel: high`.**
MEASURED over the trajectory `turns` table: of the sessions that recorded an effort, 56 on
`claude-opus-5-5` were all `medium` and 38 on `claude-opus-5` were all `high` (8 and 21 more recorded none),
with `effortLevel: "high"` in `~/.claude/settings.json` throughout. So the saved default does not reach an
Opus 5.5 seat, and every Opus spawn carries `--effort high` on its boot line, from `OPUS_SPAWN_EFFORT`
(`src/cmux/modelPin.ts`), on a Claude Code host only: `cmux spawn` defaults it for every CLI spawn (the
machine-load seat, `automation seat`, `vulnerability-fix topup`), and the ask worker, its reviewer and the drawdown
investigations pass it on the plans they open directly. It lands: a seat spawned with `--model
opus` and no `--effort` booted `claude --model opus --effort high` and its first turn recorded `claude-opus-5-5`
at `high`. Reproduce with the trajectory MCP's `trajectory_query`:
`SELECT model, reasoning_effort, COUNT(DISTINCT session_id) FROM turns WHERE started_at >= '<UTC date>' GROUP BY 1, 2`.

## What the rows are actually used for (measured)

Reproduce the whole table below — spawns per day per pinned tier, with the supervisor's own successor chain
excluded, because that chain is legitimately Fable by row 1 above and swamps every count that keeps it:

```bash
jq -r 'select(.kind=="spawned" and .bootModel.kind=="pinned")
  | select((.slug // "")|startswith("fresh-supervisor-handoff")|not)
  | (.tsIso[0:10])+" "+.bootModel.model' ~/.slopweaver/sessions/sessions.jsonl | sort | uniq -c
```

**The sonnet row is supply-limited, not ignored.** Sonnet's share of leaf spawns ran 30–43% each day, then collapsed to 5%, then 4%, then zero bar a single
spawn. Three things the count settles:

- **The collapse came the day BEFORE `--model` became required.** It is the day `model: fable[1m]`
  landed in the saved default and 27 spawns went out `inherited` — the incident above, not a choice. Making
  the pin required neither caused the drop nor reversed it.
- **What sonnet had been carrying was not this row's mechanical leaf.** The earlier population is
  `dep-bump-undici` and its nine siblings (each rebases and lands its own PR), `github-comment-verb` (a new
  verb), `cmux-spawn-control-socket-epipe` (a bug fix) — row-1 work throughout. Sonnet was over-applied, and
  what stopped was the over-application.
- **The leaf role has no supply now.** Of the 70-odd distinct non-supervisor slugs spawned over three days, not one
  is a rename, a fixture or a doc edit; they are findings, audits and capability expansions. Nine of the 227
  landings since touched no `.ts` file at all, and each was a canon ruling that took the investigation
  to write. The board became a findings board, and a finding is row 1.

**Keep the row.** It costs nothing while unused and it is the right pin the first day a genuinely mechanical
leaf appears. **NO SAVING IS CLAIMED in either direction**: no `claude` gauge reading exists from any period
with both tiers running, so what a plan-wide week charges for an Opus token against a Sonnet one is
unmeasured, and cost per landing did not visibly move across the switch.

**The fable row's denominator is the trap.** 155 spawns pinned Fable over the window; 147 are
`fresh-supervisor-handoff-*`, the supervisor's own chain, and the remaining 8 all fell on one day. A
fleet count that keeps the chain reads roughly one Fable spawn in four and looks like a breach of "one in
twenty"; excluding it, the leaf fleet is at zero — under the prescription, not over.
