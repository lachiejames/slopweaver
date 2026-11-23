# The list's page is the fleet briefing

Bundled reference for the `session-start` skill, linked from § The page. Loaded when you are rendering the
page, not on every turn. The card shape and the caps themselves are the supervisor skill's
[fleet-briefing-shape.md](../../supervisor/reference/fleet-briefing-shape.md).

## The page is the FLEET BRIEFING — there is no second artifact

Owner ruling: the ranked list lives in the fleet briefing's own react-now block, in the same card
shape, and `session-start` emits no page at all. One run of this verb feeds the whole thing:

```bash
slopweaver session-start --json --no-record > run.json
slopweaver briefing render --form - --your-list run.json --open-prs --out <html> < form.json
```

- `--your-list` projects the owner's ranked rows into the briefing's own `your list` section.
- `--open-prs` turns **every** open pull request in that same document — `ranked` and `dropped` alike, so a
  pull request sitting with a colleague is included rather than suppressed — into a react-now card naming
  its next step, **less any row whose `standing` is `ruled` or `in-flight`**, each named on the verb's
  diagnostics with the run's own reason. MEASURED: without that filter, seven of the eight cards the owner
  ruled on in a row were things already ruled or deferred, or stack members. A stacked one never reaches this
  projection at all — the leg suppresses it on `review/stack.ts`'s default-branch test.
- Both read ONE document, which is what stops the list stating a freshness instant belonging to a different
  run than its rows. The list's section states its own age off that run's `nowIso`; the eyebrow's two
  instants are the newest recorded pass (or this render, with no `--ticks`) and this render, and every card
  is aged and gated against this render. A form writing any of them is refused by name.
- **So regenerate `run.json` on EVERY render, and let the door prove you did.** Reusing the last sweep's
  file is the incident this prevents: the publish tail once dropped the `session-start` line and
  many passes later the owner's list was fifteen hours old under a header the block below it had just refreshed, and
  the owner read the page as current. `briefing render` REFUSES a `--your-list` document, or an `--open-artifacts` file, older than
  ninety minutes (`src/briefing/snapshotAge.ts` carries the measurement and the command behind it), and
  `slopweaver hatch open stale-snapshot` publishes with each stale half's age stamped above the fold in red.
  The row is journalled, so that grant is the only form, exactly as `slopweaver hatch open stale-cards` is for the
  card read.

Three rules govern the briefing, gated by `src/briefing/shape.ts`: react-now comes **first** with nothing above it, the two groupings render
**team-facing before me-facing** (audience, never permission — `AGENTS.md` rule 10), and the eyebrow states
**both** instants exactly. **Never write this page by hand** — the gate cannot catch a page nobody ran it
over. The card shape and the groupings:
[fleet-briefing-shape.md](../../supervisor/reference/fleet-briefing-shape.md).
