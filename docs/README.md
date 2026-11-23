# docs — the index

Everything under `docs/` is read on demand, never loaded as session instructions. Start at `README.md` for
the pitch and `AGENTS.md` for the rules; come here for the subsystem you are about to touch.

Two kinds of page live side by side, and telling them apart saves an argument:

- **Reference** — what a subsystem is, where it lives, what it refuses. Kept current.
- **Record** — a dated measurement, proof or finding. It describes what was true on the day it was written
  and is deliberately **not** updated, because rewriting its numbers would falsify history.

## Reference

| Page                                                             | What it covers                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [getting-started.md](./getting-started.md)                       | Install in full — Codex, `--plugin-dir`, the development loop                            |
| [what-slopweaver-is.md](./what-slopweaver-is.md)                 | The pitch, the atlases, the tiering and the module layout                                |
| [architecture.md](./architecture.md)                             | The shape: `refresh` → `derive` → `distil` → `store read`, and the diagrams              |
| [store.md](./store.md)                                           | The local Supabase store: every corpus, atlas and the board in one database              |
| [diagrams/](./diagrams/)                                         | The nine `.mmd` pictures; every module or verb a box names is real                       |
| [voice-flow.md](./voice-flow.md)                                 | How a spoken steer reaches the supervisor chair, and how the answer gets back            |
| [docs-site.md](./docs-site.md)                                   | `yarn docs` — the local Nextra site, why `site/` is not a workspace, and the diagram bar |
| [constraints.md](./constraints.md)                               | What is fixed, what was relaxed, and **the partition**. Read before planning             |
| [api-key-lane.md](./api-key-lane.md)                             | Why an Anthropic API key is not a second Max plan, and what the gauge goes blind to      |
| [security.md](./security.md)                                     | The trust model, the secrets store, and the three OpenAI egress boundaries               |
| [provider-sdks.md](./provider-sdks.md)                           | The official SDK and its types, else a strict `defineBoundary` per endpoint              |
| [browser-route.md](./browser-route.md)                           | The browser route: the owner's real Chrome through the `browser` verbs, and nothing else |
| [atlases.md](./atlases.md)                                       | Every platform atlas — what each holds, and the contracts they share                     |
| [atlas-intent.md](./atlas-intent.md)                             | What an atlas must BE — the owner's own words, and the one call the owner has not made   |
| [corpus-integrity.md](./corpus-integrity.md)                     | `audit`, `identity`, `slice` — what is in the corpus and what a rebuild lost             |
| [corpus-coverage.md](./corpus-coverage.md)                       | How far back each source actually goes                                                   |
| [freshness-contract.md](./freshness-contract.md)                 | When derived state counts as stale                                                       |
| [judgement-and-routing.md](./judgement-and-routing.md)           | Which sources a turn consults, and whose taste it applies                                |
| [console.md](./console.md)                                       | The console — the Next app under `site/` in the desktop app, and the pages it carries    |
| [tags.md](./tags.md)                                             | One tag vocabulary across localhost: every key, and which resource inherits which tag    |
| [workstreams.md](./workstreams.md)                               | Why the handover board is the only register of what is in flight                         |
| [supervisor-events.md](./supervisor-events.md)                   | The stream every long-running surface publishes its state onto                           |
| [listener-supervision.md](./listener-supervision.md)             | Keeping the Slack listener on the air                                                    |
| [cmux-client.md](./cmux-client.md)                               | The cmux client, the verbs over it, and its event model                                  |
| [session-harness.md](./session-harness.md)                       | The seam a verb reaches a running session through, with cmux behind it today             |
| [main-checkouts.md](./main-checkouts.md)                         | The pinned checkouts, and being honest about drift                                       |
| [spotlight-and-worktrees.md](./spotlight-and-worktrees.md)       | Why worktrees live under `.noindex`, and the `mds` reclaim commands                      |
| [hooks.md](./hooks.md)                                           | What runs automatically, and which one fails closed                                      |
| [environment.md](./environment.md)                               | Every `SLOPWEAVER_*` variable, break-glass and stdout marker                             |
| [dev-gate.md](./dev-gate.md)                                     | The state home, `dev gate`, and where `dev lint`'s registry lives                        |
| [toolchain.md](./toolchain.md)                                   | Every command, linter and hook this repo runs, and what each one is for                  |
| [answer-quality-scorer.md](./answer-quality-scorer.md)           | `src/eval` — grading what an answer SAID against a frozen golden, offline                |
| [proposals.md](./proposals.md)                                   | The golden proposal, as a form                                                           |
| [proof-capture.md](./proof-capture.md)                           | Photographing a real terminal for a PR's Proof of the solution                           |
| [codex-orchestration.md](./codex-orchestration.md)               | The Codex plan and review passes                                                         |
| [slack-agent-surface.md](./slack-agent-surface.md)               | What the bot looks like in Slack                                                         |
| [agent-docs-practice.md](./agent-docs-practice.md)               | What markdown docs look like: the two caps, the link tree, and citations                 |
| [recurring-failure-register.md](./recurring-failure-register.md) | Every failure class repeated often enough to earn a gate, and every class a pass killed  |
| [vanta-policy-write-loop.md](./vanta-policy-write-loop.md)       | A policy change: an HTML review page, the owner's yes, then pushed to Vanta as a DRAFT   |
| [coverage/undocumented.md](./coverage/undocumented.md)           | **The gap list** — what the code does that no doc names, and how it is kept at zero      |

## Records — measured on a date, not maintained

[agent-container-availability.md](./agent-container-availability.md) ·
[codex-plan-convergence.md](./codex-plan-convergence.md) ·
[connector-field-coverage.md](./connector-field-coverage.md) ·
[cmux-supervision.md](./cmux-supervision.md) ·
[integration-coverage.md](./integration-coverage.md) ·
[notion-connector-throughput.md](./notion-connector-throughput.md) ·
[notion-coverage.md](./notion-coverage.md) ·
[notion-attachments.md](./notion-attachments.md) ·
[notion-reach.md](./notion-reach.md) ·
[onboard-harness-findings.md](./onboard-harness-findings.md) ·
[corpus-intent.md](./corpus-intent.md) ·
[routing-preflight-proof.md](./routing-preflight-proof.md) ·
[routing-private-source-inventory.md](./routing-private-source-inventory.md) ·
[routing-streaming-baseline-proof.md](./routing-streaming-baseline-proof.md) ·
[routing-witnessed-acceptance-proof.md](./routing-witnessed-acceptance-proof.md) ·
[slack-assistant-surface.md](./slack-assistant-surface.md) ·
[slack-reach.md](./slack-reach.md)

## Where the rest of the documentation is — no page here duplicates it

These surfaces describe themselves, and a second description in prose is how two descriptions drift apart.
Enumerate them rather than reading a list:

| Surface               | Where its documentation actually is                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Every CLI verb        | `slopweaver catalog` for the surface, `slopweaver <noun> <verb> --help` for the flags — both read from the live manifest |
| Every skill           | `ls skills/` — each `SKILL.md` is loaded on use                                                                          |
| Every `dev lint` gate | `src/devLint/gateGroups.ts` — the registry names each check in run order beside the defect it exists for                 |
| The state home layout | `src/stateHome.ts`, the one typed `$SLOPWEAVER_HOME` contract; `slopweaver doctor` reports it live                       |
| The hard code rules   | `.claude/rules/*.md`, loaded as instructions every session                                                               |
