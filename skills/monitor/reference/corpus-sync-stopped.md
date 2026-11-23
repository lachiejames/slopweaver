# `corpus-sync-stopped`: a steer answers the choice, never the silence

The owner's rule, restated for the corpus: a sync that stops firing is a floating note and top
of queue. `recipe-stopped` could not deliver that for a corpus resync while a steer kept a row off its card, and
it leaves one to this card now. MEASURED: all seven corpus resyncs had
last succeeded days earlier, 22 firings missed each, and `monitor check` read `recipe-stopped STEERED — nothing to
ask the owner`. The steer said who seats them; nothing noticed nobody was. The other monitors:
[the monitors](the-monitors.md).

- **The same read, narrowed.** One `readSilentRecipeRows` per pass feeds all three stopped-row monitors
  (`src/monitor/stoppedSource.ts`); this one keeps the `resync-corpus-*` rows and ignores `steerId`. Same threshold,
  same reasons, same set key — so a newly stopped source re-posts the card — and the same `unmeasurable` answers.
  A source a seat has taken (`automation repair`), or whose current firing a seat holds, is left off it;
  [`recipe-repairing`](recipe-repairing.md) names that seat instead.
- **The card is the owner's hand, not a choice.** _Seat the corpus resyncs — a corpus source stopped syncing_, with each
  stopped source, its reason and its missed slots in `unblocks`. It carries no decision: the standing steer already made it.
- **`work` context, `floats` and `stopsWork`**, exactly as `recipe-stopped`: first on the owner's Queue under **Stopping
  your work**, and a note on the owner's screen.
- What a corpus sync does once it runs again: [corpus propagation](../../automation/reference/corpus-propagation.md).
