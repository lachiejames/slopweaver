# Ranking the board, and what "placed" means

The order, from [one-board.md](one-board.md): priority band first, then the owner's landing rows within p1, then a
row the owner RULED on ahead of one the owner did not, then a PLACED row ahead of an unplaced one, then the longest wait, then the slug.

## A ruled row

A ruled row (`handover rule` recorded the owner's decision and nothing settled it) is decided work waiting on nothing
but a seat. MEASURED: an owner's channel ruling sat 19 days ranked by age among fleet findings.
It stays inside the band, since a band is the owner's own placement, and a ruling never makes a row placed. `BoardRow.ruled`
(`src/handover/rank.ts`) carries the measurement and the count's repro.

## A placed row

A row is **placed** when somebody actually said where it sits: it declared `priority:` (never a
`priorityFrom: default` backfill, [row-priority](row-priority.md)), or it carries the instant it started waiting
(which every tag and every ask does, and no ordinary doc does).

That distinction is load-bearing. Measured on the live board: 281 rows, zero of them
declaring a priority. Ranking them anyway produced a "top 5" that was the first five slugs in the alphabet,
and the reconciliation built on it reported five starving top rows and fifteen misaligned sessions — every
finding an artefact of sorting. So an unplaced row never counts toward the top; the COUNT of unplaced rows is
reported instead, which is the honest finding and the one that pulls toward grooming.
