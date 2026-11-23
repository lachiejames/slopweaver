# Thresholds — the install's house bars, in the plan register

No limit is fixed in code; each lives in the store. The routing, spend-out, alert and acceptance bars,
the spend-out lead time, the fleet's balance bands and Codex's pause bar are no longer constants: they are the plan
register's top-level `thresholds` key, one object per provider, in whole percents (minutes for the lead time).
Absent fields decode to the defaults below and are never written back; `plans set-thresholds` is the only writer
(`src/plans/thresholdMutation.ts`), `--reset <field>` hands a field back to its default by removing it, and
`plans list` prints the values in force.

```json
{ "version": 1, "rows": [], "thresholds": { "claude": { "routeAtPercent": 94 }, "codex": { "pauseAtPercent": 97 } } }
```

| Provider | Field (flag)                                                      | Default | What reads it                                                                                               |
| -------- | ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| claude   | `alertAtPercent` (`--alert-at-percent`)                           | 75      | the react-now card; on a limited week, that share of the limit                                              |
| claude   | `acceptanceAtPercent` (`--acceptance-at-percent`)                 | 90      | the owner's acceptance test: every plan past it on both weeks at a limit                                    |
| claude   | `routeAtPercent` (`--route-at-percent`)                           | 95      | the routing bar (no new work at or past it); the chair's warning, on a limited week that share of the limit |
| claude   | `spendOutAtPercent` (`--spend-out-at-percent`)                    | 100     | the bar a weekly window is spent to near its own reset                                                      |
| claude   | `spendOutBeforeResetMinutes` (`--spend-out-before-reset-minutes`) | 300     | how long before that reset the spend-out bar applies                                                        |
| claude   | `balancedSpreadPercent` (`--balanced-spread-percent`)             | 10      | a fleet at most this far apart in one window is balanced                                                    |
| claude   | `driftingSpreadPercent` (`--drifting-spread-percent`)             | 15      | past it the fleet is out of band; between the two, drifting                                                 |
| codex    | `alertAtPercent` (`--alert-at-percent`)                           | 75      | the Codex react-now card                                                                                    |
| codex    | `pauseAtPercent` (`--pause-at-percent`)                           | 99      | the Codex pause bar: a window at or past it takes no new work                                               |

**A present value is strict, because a lenient one widens spend.** An unknown provider or field, a non-integer,
a percent outside 1..100, a lead time outside one week, or an ordering the gates cannot honour refuses the whole
register as `REGISTER_INVALID`: Claude alert < acceptance < route ≤ spend-out, balanced < drifting, and Codex
alert < pause. A row's usage limit still caps below the bar: the effective ceiling is the lower of the two, and on a
weekly window the limit binds, the card and the chair's warning sit `alertAtPercent` and `routeAtPercent` of the way
to it (`src/claude/budgetAlertPoint.ts`); the gauge's `NEAR` marks the effective ceiling itself.
`src/plans/thresholds.ts` is the decoder; `claude gauge --json`, `codex gauge --json` and the tick ledger record
the values a verdict was judged under.

## Where it is tested

- `src/__tests__/unit/plans/thresholds.test.ts` — the decoder's defaults and refusals.
- `src/__tests__/unit/plans/thresholdMutation.test.ts` — a threshold change's set, reset, no-op and ordering
  refusals.
- `src/__tests__/unit/cli/commands/plans/thresholdArgs.test.ts` — the `set-thresholds` flags and the `plans list`
  lines.
