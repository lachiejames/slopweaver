# `codex-plan-signed-out`: the fallback stays unasked, the sign-in is carded

When a Codex plan is paused as unsigned, falling back to a signed-in plan is right, and the owner also gets a very
high priority, top-of-queue card saying the fleet was not able to sign into the plan and which commands the owner
needs to run.
The other monitors: [the monitors](the-monitors.md).

- **Why the owner tried a different plan, and how it differs from a cap.** Routing ranks every registered store and
  excludes one the live read finds `signed-out` or `store-missing` (`src/codex/rank.ts`), exactly as it moves off
  a capped one. The difference is what the card says: a cap resets itself on the provider's clock, a sign-out
  never does — only the owner's `codex login` into that store ends it.
- **Two halves, because the live read is too heavy for a pass.** `readCodexFleetSnapshot` — the read every
  Codex pass, `codex route` and a Codex seat already run — files each store's answer as its alias's
  `codex_sign_in_observation` row in the local store (`src/codex/signInRecordStore.ts`), stamped with
  `auth.json`'s mtime, ctime and size, never a byte of it, each alias written by compare-and-set on its revision
  and never retried, so an older signed-in read never undoes a newer refusal. An alias with no row imports its
  `$SLOPWEAVER_HOME/codex-signin/<alias>.json` once, and nothing writes that directory. The monitor reads the row
  beside the store's own `auth.json` shape (`src/codex/auth.ts`); a store it cannot reach reads as unmeasurable,
  never clear, and never falls back to the file.
- **What fires.** A missing store, no `auth.json`, one that does not parse, one with no sign-in in it, or a live
  refusal while `auth.json` is still the version refused. A paused row still fires, naming the pause: the owner pays
  for the plan either way.
- **The card.** _Sign Codex plan `<alias>` back in — paste the copied command into your terminal_, one per
  plan, with `CODEX_HOME=<store> codex login` on the owner's pasteboard (`codexLoginCommand`), what failed in
  `unblocks`, and `work` context plus `floats` for the top of the queue and a note. The floating note and the
  card are one step, so they carry the same facts. `unblocks` never names the store path — the pasted command
  carries it whole — and a long pause reason is cut with a visible `…`, keeping the cap-versus-sign-out answer.
- **How it is verified afterwards.** A new sign-in changes the stamp, which clears the card on the next pass;
  the next live read then files signed-in, or files a fresh refusal against the new stamp and the card returns.
- **The moment is the next pass.** The skip is recorded when the routing read runs; the card arrives on the
  next `monitor check --fire`. Every supervisor tick runs `codex route --json` and fires this monitor straight
  after it (`src/supervisor/scratch/fleetReadings.ts`), so a sign-out is read and carded on the same tick even
  when no Codex pass or seat ran. A record that will not
  decode reads `unmeasurable`, never clear; a record write that fails warns on stderr and never fails the
  routing read, since unblocking Codex outranks the card.
