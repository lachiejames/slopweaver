# Propagation map — what a corpus sync leaves stale, and what brings it current

Generated from `src/live/resync/propagation.ts` by `renderPropagationMapMarkdown`; a unit test fails when the
two differ, so edit the declaration and regenerate, never this file.

Every successful `slopweaver automation resync --source <s>` ends in three steps, in this order:

1. **Silver** is already current: `refresh` runs `derive` after every fetch.
2. **Readings** the map marks `re-derived` are taken again by the resync itself, in code, no model, and
   each receipt (`readingId`, `observedAtIso`) lands in `$SLOPWEAVER_HOME/live/recipe/propagation/`.
3. **Judgement** joins ONE visible pass: the first sync seats an Opus session through `cmux spawn` on a
   dispatch board row, and every later sync joins that open pass rather than seating another.
   `slopweaver automation propagate --status` prints what it covers.

A resync whose propagation fails still succeeded as a sync; the failure is on the record the pass reads.

## Where each surface is drawn

- `pull-requests-review-state` — console `/pull-requests` and the queue's `pr` rows, from `reading last --producer 'github landing'`
- `queue` — console `/queue` ask, hand, draft, post and act rows, each a live verb per request
- `workstreams` — console `/fleet`, from `reading last --producer 'handover reconcile'` and the live board
- `fleet-briefing` — `$SLOPWEAVER_HOME/pages/fleet-briefing/`, published by `briefing render`

## Per source

### `github`

- `pull-requests-review-state` — re-derived by the resync: fresh `github landing` reading
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `slack`

- `pull-requests-review-state` — re-derived by the resync: fresh `github landing` reading
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `linear`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `notion`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `gmail`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `calendar`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `fathom`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `chatgpt`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

### `outlook-calendar`

- `pull-requests-review-state` — live — the landing derivation reads GitHub live and Slack bronze, never this source
- `queue` — live — every register is re-read per request; the pass decides which rows the sync changed
- `workstreams` — judgement — board rows and their tags are journal state; only the pass can say one moved
- `fleet-briefing` — judgement — `briefing render` needs the chair's typed form; its freshness section reads resync-state at render

## What no corpus sync feeds

Atlases feed only the Fleet Briefing's freshness section, read at render time; hand cards are frozen at
`hand post`. Neither is re-derived after a corpus sync.
