# The integration lane's coverage

**The integration lane is measured and reported, in its own report directory, and it is NOT gated**; the unit
lane is the one the floor reads. The evidence for each half is below, including two traps in the coverage
config that `coverageGlobs.ts` closes, one of which hid a whole subsystem from the unit floor's field of view
when measured.

Measured on the tree at the commit that added this file, Node 24.11.1, Vitest 4.1.10, replay mode (offline,
free, deterministic — no cassette was recorded).

```bash
yarn test:unit                      # → coverage/            (gated: the floor ratchet reads this)
yarn test:integration:coverage      # → coverage-integration/ (report-only: nothing reads it)
```

## What the lane runs: recorded provider suites are quarantined

**No recorded provider cassette is committed.** The only committed HAR is the synthetic
`src/__tests__/fixtures/cassettes/safe/recording.har`, which the unit lane's tripwire and body-fidelity
ratchet walk. Replay fails a suite whose HAR is missing, so every suite that replays a recorded provider
cassette is excluded by name in `config/vitest/integration.ts` (`QUARANTINED_CASSETTE_SUITES`), and the lane
runs the suites that need no recorded traffic. A suite leaves that list when it is re-recorded against a
tenant ([below](#re-recording-a-cassette)).

The numbers in Results 1 and 2 were measured over the recorded set that lane then replayed, and describe that
set; the commands under [Reproducing it](#reproducing-it) now measure the lane as it is.

## Result 1 — the number

| lane                                  | statements             | branches              | functions            | lines                  |
| ------------------------------------- | ---------------------- | --------------------- | -------------------- | ---------------------- |
| unit (`coverage/`)                    | **76.06%** 11671/15344 | **71.71%** 7879/10987 | **74.37%** 3015/4054 | **76.16%** 11246/14766 |
| integration (`coverage-integration/`) | **11.61%** 1782/15344  | **9.20%** 1011/10987  | **12.55%** 509/4054  | **11.83%** 1747/14766  |

The integration lane executes at least one statement in **71 of the 357 measured source files**. It is
concentrated where you would expect a cassette-driven lane to be, and absent everywhere else:

| subsystem      | integration statements | subsystem       | integration statements |
| -------------- | ---------------------- | --------------- | ---------------------- |
| `src/corpus`   | 1036/3867 (26.8%)      | `src/cli`       | 11/4083 (0.3%)         |
| `src/live`     | 202/363 (55.6%)        | `src/retrieval` | 0/481 (0%)             |
| `src/outbound` | 158/1154 (13.7%)       | `src/silver`    | 0/714 (0%)             |
| `src/lib`      | 152/543 (28.0%)        | `src/admit`     | 0/190 (0%)             |
| `src/llm`      | 91/163 (55.8%)         | `src/codex`     | 0/733 (0%)             |
| `src/gold`     | 83/242 (34.3%)         | `src/handover`  | 0/562 (0%)             |

## Result 2 — what the number says that the unit number does not

This is the step that decides it. Percentages cannot answer it; the two lanes' statement maps can. Both
reports were generated with the `json` reporter and compared statement by statement, keyed on source
position.

| statements (of 15344 measured)       | count   | share     |
| ------------------------------------ | ------- | --------- |
| covered by BOTH lanes                | 1536    | 10.01%    |
| covered by the UNIT lane only        | 10135   | 66.05%    |
| covered by the INTEGRATION lane only | **246** | **1.60%** |
| covered by NEITHER                   | 3427    | 22.33%    |
| union of both lanes                  | 11917   | 77.67%    |

Two readings of the same row:

- **86.20% of everything the integration lane covers, the unit lane already covers.** The lane's 11.61% is
  mostly a re-measurement of code the unit floor already guards.
- **The remaining 1.60% is real and is exactly what a unit test in this repo cannot reach** — no mocks, no
  I/O, so the transport and write paths have no other lane. All 246 statements live in 13 files:

| statements only the integration lane reaches | file                                                                   | unit coverage of that file |
| -------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| 68                                           | `src/corpus/slack/writeApi.ts`                                         | 13%                        |
| 35                                           | `src/corpus/slack/api.ts`                                              | 3%                         |
| 32                                           | `src/corpus/linear/fetch.ts`                                           | 70%                        |
| 32                                           | `src/llm/claudeCli.ts`                                                 | 40%                        |
| 24                                           | `src/corpus/github/write.ts`                                           | 0%                         |
| 16                                           | `src/corpus/github/fetch.ts`                                           | 68%                        |
| 13                                           | `src/corpus/slack/curatedFetch.ts`                                     | 43%                        |
| 9                                            | `src/connect/probes.ts`                                                | 6%                         |
| 8                                            | `src/corpus/linear/transport.ts`                                       | 85%                        |
| 3 / 3 / 2 / 1                                | `slack/fetch`, `live/slack/projection`, `linear/write`, `hygiene/scan` | 93–95%, 44%                |

So the answer to "is the number meaningful?" is split, and the split is the whole finding: **the lane carries
information the unit lane does not, and the lane's PERCENTAGE is not where that information lives.**

## Recommendation — report-only, no second floor

**Do not add a second floor.** Not because the lane is worthless — because a percentage floor on this lane
cannot detect the loss it would be sold as preventing. The arithmetic:

- Delete every cassette assertion that reaches a statement no unit test reaches — all 246 of them, the entire
  unique value of the lane — and the lane's statement number falls from **11.61% to 10.01%**. A floor with any
  honest tolerance sits below that. The gate stays green through the total loss of the thing it exists for.
- Meanwhile 86.20% of the number moves for reasons the unit floor already owns, so the floor would go red for
  changes that are already gated elsewhere, and the second yardstick would be the one people edit to get
  green. One pull request spent six review rounds removing exactly one such editable number; adding a second is the
  wrong direction.

**The measurement, not a gate**: `yarn test:integration:coverage`, its own report directory, no gate reads it.

If a gate is ever wanted here, the shape the evidence points at is **presence, not percentage** — a pinned
list of modules that the integration lane must EXECUTE at all (`src/corpus/*/writeApi|api|transport`,
`src/llm/claudeCli.ts`, `src/corpus/github/write.ts`), failing when a listed module's integration coverage
reaches zero. That is a different gate with a different failure mode, and it needs the owner's call on the
list before any code — it is deliberately not built here.

## Two traps in the coverage config

### 1. One report directory for two lanes

Both lanes spread [`config/vitest/base.ts`](../config/vitest/base.ts), whose coverage `reportsDirectory` is
`coverage` — the exact path [`coverageRatchet.ts`](../src/devLint/coverageRatchet.ts) reads. Running the
integration lane with `--coverage` into that directory overwrites the unit lane's report **in place**, and the
floor gate then compares the integration number against the unit floor:

```
$ yarn vitest run --config config/vitest/integration.ts --coverage \
    --coverage.reportsDirectory=coverage src/__tests__/integration/slackReadThread.test.ts
$ yarn coverage:ratchet
coverage-ratchet: coverage dropped below the committed floor:
  branches: 1.61% < floor 66%
  functions: 1.87% < floor 68%
  lines: 1.98% < floor 70%
  statements: 1.93% < floor 70%
raise coverage until it clears the floor; the floor itself may not be lowered to suit.
$ echo $?
1
```

(One test file, for speed; the full lane clobbers the same file with 11.61%, equally below every floor. The
unit report was restored from a copy afterwards, and the ratchet went back to `clean`.)

The integration lane therefore reports to `coverage-integration/`, and that is the first requirement of
measuring this lane at all, not a tidiness preference. With the split in place, the two lanes in sequence
leave the gated report byte-identical:

```
$ yarn test:unit && shasum coverage/coverage-summary.json
<sha1>  coverage/coverage-summary.json
$ yarn test:integration:coverage && shasum coverage/coverage-summary.json
<same sha1>  coverage/coverage-summary.json
$ yarn coverage:ratchet
coverage-ratchet: clean (floor {"branches":66,"functions":68,"lines":70,"statements":70})
```

### 2. Anchored coverage globs — unanchored, `eval/**` also excludes `src/retrieval/**`

Vitest matches `coverage.include`/`coverage.exclude` with picomatch's `contains: true` against each file's
**absolute** path (`BaseCoverageProvider.isIncluded`, `vitest/dist/chunks/coverage.*.js`). A repo-relative
pattern is therefore unanchored — it is satisfied by any directory in the path, including directories the repo
does not own. Two consequences, both measured on this tree:

- **`eval/**` in [`coverageExclude.ts`](../src/devLint/coverageExclude.ts) — written for the top-level `eval/`
  directory — matched `src/retrieval/**` while unanchored, measured at the commit that added this file.** 24 first-party source files, 589 statements, fell
  outside the measured denominator in every checkout, CI included. `src/retrieval` holds the fan-out and
  cite-token contracts of the read tier. A regression to any of it could not move the floor gate, and the gate
  printed `clean`. This is the same defect class the exclusion pin
  (`coverageExclusions.test.ts`) exists to prevent — the pin checks what the list SAYS, and the list never
  said `src/retrieval/**`.
- **A checkout whose own leaf directory ends in `coverage` lost the report entirely.** `coverage/**` matched
  every source file; both lanes reported `0/0` statements and the ratchet could say nothing better than
  `coverage summary: unexpected shape`. One such trap exists per leading segment of the exclude list, so a
  clone under a directory ending in `dist`, `eval`, `hooks` or `stubs` collapses the same way.

[`coverageGlobs.ts`](../src/devLint/coverageGlobs.ts) anchors each pattern at the project root, so the list
says what it says about this repository only. Effect on the gated number:

| unit lane                | statements | branches | functions | lines  |
| ------------------------ | ---------- | -------- | --------- | ------ |
| before (24 files unseen) | 75.38%     | 71.48%   | 73.44%    | 75.53% |
| after                    | 76.06%     | 71.71%   | 74.37%    | 76.16% |

The number goes **up**, because the hidden code was well covered (589 statements at 93.04%). The exclusion was
not flattering the percentage; it was hiding a subsystem from the gate. The floor itself is a ratchet
(`src/devLint/coverageFloor.ts`).

## Out of scope

- **Cassette re-recording** — everything here is replay. No cassette was recorded, and the integration
  number is therefore a number about the recorded seams, not about live services.
- **Real-`git`-subprocess tests** run in their own `src/__tests__/subprocess/**` lane
  (`config/vitest/subprocess.ts`, `yarn test:subprocess`), off the pure-function unit bar; the percentages
  above are not re-derived for that split.

## Reproducing it

```bash
yarn test:unit                                   # coverage/coverage-summary.json
yarn test:integration:coverage                   # coverage-integration/coverage-summary.json
yarn coverage:ratchet                            # still reads the UNIT report; prints the floor it used
```

Add `--coverage.reporter=json` to both to get `coverage-final.json` statement maps, which is what the union
comparison in Result 2 needs; percentages alone cannot answer the subset question.

## Re-recording a cassette

A quarantined suite records nothing while it is on the list, in any mode. Delete its line from
`QUARANTINED_CASSETTE_SUITES` first, record it with
`POLLY_MODE=record yarn vitest run --config config/vitest/integration.ts <suite>`, and commit the HAR with the
line still gone. The unit lane's `cassetteBodyFidelity` ratchet then asks for that recording's counts in
`src/__tests__/cassetteBodyDebt.ts`.

**Recording one is pre-approved — never stop to ask.** Recording a live cassette
is ALWAYS greenlit, and an agent that stops to ask permission for it is a defect. The traffic a record run
makes is self-addressed and expected — the bot's own DM, the owner's own mailbox, a throwaway Linear issue and
comments on it, a private Notion page — and the duty that comes with it is CLEANUP, not permission: what a
lap mints, it removes. The full statement, the targets and what the board does to a session that asks anyway
are in [.claude/rules/testing.md § Recording a cassette is pre-approved](../.claude/rules/testing.md#recording-a-cassette-is-pre-approved--never-stop-to-ask),
which every session loads; this is the one sentence a session standing in the record path needs, not a second
copy of it.

Replay needs no credentials. **Recording** does, and the suite reads them from a `SLOPWEAVER_RECORD_*`
family kept deliberately distinct from the variables the shipped program reads
([environment.md](./environment.md)), so a normal run can never reach a live service by accident:
`SLOPWEAVER_RECORD_SLACK_TOKEN`, `SLOPWEAVER_RECORD_SLACK_BOT_TOKEN`, `SLOPWEAVER_RECORD_SLACK_WORKSPACE`,
`SLOPWEAVER_RECORD_SLACK_DM`, `SLOPWEAVER_RECORD_GITHUB_TOKEN`, `SLOPWEAVER_RECORD_GITHUB_HEAD`,
`SLOPWEAVER_RECORD_LINEAR_TOKEN`, `SLOPWEAVER_RECORD_LINEAR_TEAM` and `SLOPWEAVER_RECORD_LINEAR_STATES` (two
distinct workflow-state UUIDs of that team, comma-separated — `slopweaver linear states --team <KEY> --json`
prints them; the follow-up cassette moves one issue between them to overflow a nested connection), plus a per-slot
`SLOPWEAVER_RECORD_SLACK_CHANNEL_<slot>` override. Recording is selected by `POLLY_MODE=record`, and a test
whose variable is missing **throws** rather than recording an empty cassette. An unset `POLLY_MODE` is offline
`replay`; a value that is not `record`, `replay` or `passthrough` (a typo such as `recrod`) **fails the run at
load**, naming the valid modes, rather than passing as a replay.

## Paging is a replayable property

A recorded cursor keeps its identity. `next_cursor`, `endCursor`, `nextPageToken` and their kin are a
`cursorKeys` class in `src/__tests__/cassetteRedactConfig.ts`: the allowlist redactor persists each distinct
bookmark as a stable synthetic `cursor_N` through the same map an id uses, and an empty cursor — the
provider's own last-page signal — stays empty. A request that sends a cursor back (`cursor`, `start_cursor`,
`after`, `pageToken`: the provider's `cursorParams`, read from the query string, a form body or a JSON body)
is keyed on that identity by `setup-polly.ts`'s `configureCursorMatching`, so page two and page three are
distinct recordings, a follow-up that drops its cursor replays page one and fails a disjointness assertion,
and one that sends a bookmark no page handed out finds no recording at all. `slackPaging.test.ts` is the
worked example and the deliberate-break proof is in its header.

Three consequences to design against:

- **A request carrying no cursor keeps the identifier it was recorded under.** Polly folds a matcher into a
  request's id only when it is configured, and the cursor matcher is configured only when a cursor parameter
  is present, so no cassette recorded before cursors had identity moved. Page one of the paging cassette has
  the same `_id` as the crawl cassette's own `users.list` entry — check it with `grep -o '"_id": "[^"]*"'`
  over both.
- **A record run learns a cursor the moment the response arrives, not at persist time.** Polly identifies a
  request when it is made and persists at flush, so `setup-polly.ts` folds every response into the id-map
  in the `response` event; the follow-up's real cursor then resolves to the `cursor_N` page one minted. The
  persist-time pass runs the same pure redactor over the same map and mints nothing new.
- **A cursor the map has never seen collapses to `<cursor:unmapped>`, never to its raw value** — so a real
  bookmark never reaches an identifier hash, and a cassette carrying `[REDACTED]` under a cursor key cannot
  page until it is re-recorded. The write suites' read-backs hold such leaves; none of them pages, and each
  becomes `""` or `cursor_N` on its next re-record.

The GraphQL nested follow-up (`ParentConnection`) keeps its own fixed-sentinel key and order-sensitive
matching — [cassette-followup-redaction.md](./cassette-followup-redaction.md) says why — and a root-level
page's `after` goes through the cursor identity like every other bookmark.
