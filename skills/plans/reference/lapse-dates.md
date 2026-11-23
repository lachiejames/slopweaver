# When a plan's paid subscription ends

When a paid subscription ENDS is a different fact from whether it is paused, and recording it changes no
eligibility: no pause, no probe skipped, no route moved, a past date included. A renewal records over the old one.

```bash
slopweaver plans lapse --provider claude --plan plan-two --on <iso>   # strict ISO-8601 instant, kept as typed
```

`plans list` and every `PLAN` line of `claude gauge` end on `lapses <iso>`, or `lapse UNRECORDED` when nobody has
said, so a briefing reading either never mistakes an unknown end for an open-ended plan (`src/plans/lapse.ts`).

## A Codex row reads its provider-stated date too

Each Codex store's sign-in (`$CODEX_HOME/auth.json`, its `id_token` claims) states when the paid period ends, so
`plans list` prints `paid through <iso> (provider-stated, checked <iso>)` in place of the recorded clause: a local
file read, no network (`src/codex/subscriptionDates.ts`). A recorded lapse naming a different instant, to the last
fractional digit, is kept beside it, flagged `DIFFERS`; a store whose sign-in states none prints
`paid through UNREAD (<why>)` and keeps the recorded clause.

## Anthropic states no such date

Over any interface this machine uses, measured on `GET /api/oauth/profile` (status, start date and tier only) and
`/api/oauth/usage`, Anthropic states no renewal, period-end or cancel date. So a Claude lapse is what `plans lapse`
records, or nothing.
