# Reading a plan's monthly spend

**A Claude plan's spend is read by `claude spend`, and by nothing else.** `slopweaver claude spend --plan <alias>`
binds the plan's proven sign-in by the same step as `claude reset` (`src/cli/commands/claude/planLogin.ts`), reads
the `extra_usage` block of `GET /api/oauth/usage` (minor units of its currency; strict, so a drifted or absent block
refuses and is never read as zero), and records it in the readings ledger under `claude spend`.

- **A reading is evidence for one hour**, the provider's own `retry-after` on that endpoint. A throttle exits 4 and
  records nothing.
- **The usage limit applies in dollars.** `src/claude/spendPolicy.ts` applies it to a reading: at
  `used × 100 ≥ limit × usageLimitPercent` the plan is at its limit.
- **Which block an Enterprise seat's admin limit arrives in is MEASURED ON NO SEAT yet.** The first read on a
  registered Enterprise seat settles it.
- **Every Claude routing gate reads it.** `readClaudePlanSpends` (`src/claude/spendBudgets.ts`) turns each
  `monthly-spend` row's newest hour-fresh reading into a verdict: open (ranked by the share spent), usage-limit,
  provider-refused, or not-measured when no fresh reading exists. Spawn, rotation, the watch, the `PLAN` line and
  capacity all rank on that, so recording a reading is what puts the seat to work
  ([register and routing](register-and-routing.md)). Open, the row is the FALLBACK lane behind every eligible
  weekly plan, least spent first; with no fresh reading it takes no work. Its store is never probed by
  `claude gauge` or `claude watch`; the watch's active-slot probe and `claude signin` still read what they find.
- **A running seat's prompts read it too.** On a `monthly-spend` plan under 100%, the `UserPromptSubmit` seat check
  holds each prompt at the limit, or as NOT MEASURED with no reading at most an hour old, and names `claude spend` as
  the remedy (`src/claude/seatUsageGate.ts`). It caches no pass, so every such prompt reads the ledger in full.
