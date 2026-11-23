# The wall gate — what a run is, and whose it is

Bundled reference for the `slack` skill. `slack reply` refuses a send that would take OUR unbroken run in
that thread past **5** consecutive messages. `slack post` never carries a `--thread-ts`, so it never
triggers this.

`WALL_RUN_LIMIT = 5` is measured, not chosen: in the `#proj-monitoring` thread that provoked the gate,
the highest run any HUMAN posted was 5, spread over ~28 hours. A rule at 5 refuses the sixth message of a
wall and never constrains a human-shaped posting cadence.

## What the refusal names, and why it names ONE

The refusal carries the projected count, the last message from someone else, and the permalink of our own
first message in the run — the fix it names is to edit that existing run into ONE message rather than
append to it. It says ONE rather than "fewer" deliberately: measured, a session told to
consolidate went from eight messages to four and posted those, which the owner then deleted. "Fewer" is
satisfied by any decrease at all.

For one deliberate append, re-run after `slopweaver hatch open wall --reason "<why>"` — after checking with the operator, never
automatically.

## The two lanes count different things

- **`--as bot`** counts every earlier consecutive message from the bot's identity at the thread tail,
  because this system sent all of them.
- **`--as me`** counts NONE of them. In that lane our identity is the owner's own account, which the owner
  personally types into, and a reply the owner wrote by hand is not Slopweaver building a wall. So an `--as me` drip is
  judged purely on its own message count: five passes, six is refused.

The instance that decided it, on a pull request: two earlier replies of the owner's own stood at the tail,
the drip the owner had explicitly ruled was five messages, the gate projected seven, and messages four and five
only went out under the break-glass. The owner's ruling — what the owner asked is the source of truth and overrides a gate's
arithmetic.

## Two consequences worth knowing before you rely on this

**Accumulation across separate `--as me` sends is not seen.** The 17-message wall this gate was built
for was four sends of 4, 4, 8 and 1 (measured); the eight trips on its own count, but a 4 + 4 + 5 + 4
repartition builds the same wall unrefused. Telling a message Slopweaver sent as the owner from one the
owner typed would need a per-timestamp provenance record that does not exist — the send reservations are keyed by
a content hash on a 24-hour window, and that incident spanned about 28 hours. The cost is accepted, not
overlooked.

**The `--as me` lane does not fail open on a failed thread read, and the bot lane does.** The bot lane
cannot decide without the standing run, so a flaky read there is a pass. The as-me lane already holds the
only number that matters before the call, so a failed read costs it only the prose about who last replied —
failing open would hand a caller an unlimited drip whenever `conversations.replies` hiccups or the thread
runs past the 200-page walk.

Source of record: `src/outbound/slack/wallGate.ts`, wired in `src/cli/commands/slack/wallCheck.ts`.
