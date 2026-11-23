# The `queue-pinned` step — the voice lands in the owner's one Queue tab

Part of [`desktop e2e`](e2e.md). The voice's `browser_open` of the Queue once opened a second Queue tab and the
next card followed it there; the voice controls the one static Queue tab, which never closes.

With a page opened beside the Queue in front, the step sends a real Queue card from the voice window's own
`presentConsoleCard` (what `open_card` sends), then the Queue deep link the voice's `browser_open` mints
(`/queue?context=slopweaver`). The deep links go to the test instance's own `open-url` handler from its main process,
never through macOS, which would reach the owner's app.

Each of those two moves must add no tab, select the pinned one and leave exactly one console page on the Queue, and the
card must be on it. Each break is named in `QUEUE_NOT_PINNED`; the judge is `src/desktop/e2ePinnedQueue.ts`. The step
photographs the strip beside its own photograph (`…-queue-pinned-strip.png`) and closes the tabs it opened from the
strip's own close buttons, so later steps find the walk's console page and not one of its tabs.

```bash
slopweaver desktop e2e --app <candidate> --only queue-pinned
```
