# Reading a `still-loading` verdict

A `desktop e2e` step fails `still-loading` when something on the page still matches the perf walk's loading selector
(`LOADING_SHOWN`, `src/consoleProfile/plan.ts`) at the settle cap (30 s unless `--settle-cap` moves it). The verdict names every mark it still saw, none
dropped, each as its element, the selector parts it matched, the console spinner's own label (`[data-spinner]`,
`site/components/ui/spinner.tsx`) and the labelled region it sits in
(`src/cli/commands/desktop/e2ePage.ts` `readFrame`). So the failure points at the read that never landed, not at the
page.

## A busy mark over data in hand is the usual cause

A fresh window hands each section the console's saved readings (`site/lib/savedReadings.ts`) and re-reads them, every
one queued behind the page's other first reads in three live-read slots (`site/lib/liveSlots.ts`), where a page's
primary content (the Queue's registers, `useLive`'s `primary`) goes ahead of the shell's badges. Under the machine's
usual load that takes 25 to 31 s. A section that marks itself busy (`aria-busy`, a block spinner) while it holds a
handed-over reading therefore fails the walk although the page is drawn.

The rule a section follows: draw a handed-over reading with an inline re-reading mark, and keep the busy mark for a
read with nothing in hand. Alignment's acts section and Start here follow it (`overlaysReadOf`, `site/lib/pageEmpty.ts`),
and so does Fleet's doctrine panel (`doctrinePendingOf`, `site/lib/fleetDoctrineInput.ts`): a handed-over input
reads "not read" as not yet current and never counts, but only an input with nothing in hand marks the panel busy.

## On a worktree's dev console, or at a longer cap

`--checkout <worktree>` walks a DEV server: each route compiles on its first hit, so a read can take seconds the
production console answers in milliseconds (measured: `/api/talk/list` 3.7 s on a worktree's, 2 ms on main's). A step
at the default `--settle-cap` of 30 s says only that the page had not settled by then; a longer cap (at most 600), with
`--only` on that step, measures when it does, or names what is still loading at the longer cap.

Before calling a `still-loading` step a regression, check whether the named section holds a reading. Re-take it with
`--only <step>`; on a worktree's dev console, every route also compiles on its first hit.
