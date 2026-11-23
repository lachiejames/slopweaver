# Boots refused — every new seat refuses to start, and the chair seats one investigator

The plans register lives in the store, and every Claude spawn reads it to judge the usage limit the owner set
on each plan. When it does not read, every spawn refuses — pinned or not ([plan routing](plan-routing.md)). The
owner's rule: the chair says no new sessions can launch right now, seats an investigator through the escape hatch,
and fixes it. A manager whose staff are locked out unlocks the door, and a chair without the ability or freedom to
is a misalignment, because the doctrine is capacity maxing. The refusal itself stays: a migration is never forced
blind, judgement applies it.

## Why the chair has to be told

When the store fell one migration behind, every boot refused, and the chair launched nobody. The tick had closed
minutes earlier and the chair was asleep. The one detector, `claude watch`, posted the `claude-plan-unusable`
register card to the OWNER's screen only. Nothing reached the chair, so no spawn was even attempted. The spawn
refusal also said no hatch existed, which was false for a stale store.

## How it reaches the chair now

- **The courier wakes it within seconds.** Every pass, before its batch pass, `talk courier` looks for an open
  `mon-claude-register-<digest>` card in the hand register. That register is a file, readable while the store is
  down. It re-reads the plans register, claims the card under `$SLOPWEAVER_HOME/talk/boot-refusals/`, then types ONE
  `[boots refused <card>] …` line. The claim stops a second courier, or a `--once` backstop, typing it again. A
  claim is released only when nothing was typed (the owner's words in the composer, cmux unreachable), so the next pass
  retries. The code is `src/talk/bootRefusalWakeShell.ts`, and the line itself is `src/transcripts/bootRefusalWake.ts`.
- **The tick leads with it.** `tick open`'s digest prints `BOOTS REFUSED — …` straight after the Queue leader
  whenever its own `claude-plans` pass carries the register subject (`src/supervisor/digestBootsRefused.ts`).
  It prints `boots refused: UNKNOWN` when that reading could not say, and nothing at all when the register reads.
- **Transcript readers skip it.** It is the chair being told something, never the owner speaking. The transcript
  reader drops the exact line as machine traffic (`boot-refusal-wake`) and keeps any text that adds to it.

## What you do with it

1. **Say it.** In one line to the owner's surface: no new sessions can launch right now, and why.
2. **Read which case it is.** The wake line names the case from a register read a moment ago, but the store can heal
   in that moment, so confirm with `slopweaver store status` before you seat anyone.
   - **Stale store** (`the store answered and was refused as stale`). The store answers, and `connectStore`
     refused it because its migration record is behind the journal. The `stale-store` hatch opens the store as it
     stands. While the `plan_register` row still queries on that schema, the register and every usage limit in it
     READ, so the spawn meets the usual limit gate with a register in hand. Run the two commands the line names,
     each on its own:

     ```bash
     SLOPWEAVER_ALLOW_STALE_STORE=1 slopweaver handover register --ask "Investigate why every boot refuses (<card>)" --dispatch --slug boots-refused-<digest> --priority p0
     SLOPWEAVER_ALLOW_STALE_STORE=1 slopweaver cmux spawn boots-refused-<digest> --driver claude --model opus
     ```

     `--driver claude` is required, because an omitted driver re-reads the register to pick a host. Never pass
     `--plan` either, which does the same. ONE investigator, never a fleet.

   - **Anything else** (`the store is not merely stale`). The store cannot be opened, or the register is invalid. No
     hatch boots a seat, and none should. Read `slopweaver store status` and `slopweaver plans validate` from this
     chair, and make the store readable. The chair is a running session and needs no new boot.
3. **Keep the refusal.** The investigator JUDGES the pending migration, and so do you. Never run a blind
   `slopweaver store push` to make the error go away: a migration that is not on `origin/main` byte for byte has its
   own refusal (`unlanded-migration`). An additive catch-up of a landed migration already happens at the door
   ([store lifecycle](../../../docs/store/lifecycle-and-schema.md)), so a store still refused as stale is one the
   door would not catch up. That is the case worth a seat.
4. **It ends** when the register reads again. The next measured `claude-plan-unusable` pass settles the card. The
   tick's line goes quiet, and the next wake waits for a new card.

## What this does not change

- **The hatch is ambient and not a widening.** `stale-store` (`src/hatch/stateLifecycleHatches.ts`) already existed
  for exactly this kind of read. This adds the exception the owner named to its row. The usage-limit gate is untouched:
  nothing here boots past an unread limit.
- **No daemon, no automatic spawn (rule 2).** The courier lives inside the visible chair and only types. The chair
  decides, and its spawn is a visible cmux seat.
- **The owner's card still goes up.** The owner's floating note is unchanged. The chair hearing about it is an addition, not a
  replacement.
