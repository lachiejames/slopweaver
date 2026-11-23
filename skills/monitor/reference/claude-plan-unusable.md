# `claude-plan-unusable`: one floating note per Claude plan a probe finds broken

A plan once sat signed out for about 72 hours with nothing saying so, so the owner gets a floating note on the
owner's screen if one of the plans is not set up locally, or signed out, or something is wrong with it, because
otherwise nothing tells the owner. The other monitors: [the monitors](the-monitors.md).

- **Two halves, because a pass may not probe.** `claude gauge` (every supervisor tick), the `claude watch`
  keep-alive and the pre-spawn routing gate (every spawn and `claude route`, `src/claude/spawnGauges.ts`) already
  probe every registered plan. Each files what it found in the store's `claude-plan-probes` singleton row
  (`src/claude/planProbeRecord.ts`, `src/claude/recordPlanProbes.ts`); the gate files each plan's EFFECTIVE probe,
  so a plan it repaired on the way records as read, never as the refusal it first met. The monitor reads that row
  beside the plan register's unpaused Claude rows, so the pass stays a local read.
- **What fires.** The plan's store directory is gone (`STORE_MISSING`), nothing is signed in (`STORE_NOT_READY`), or
  Anthropic rejects the sign-in (`CREDENTIAL_REJECTED`). The keep-alive files a rejection only after its own repair
  failed: an idle store's eight-hour access token expiring behind a live refresh grant is refreshed and re-probed in
  the same tick, so it never reaches the owner. The repair takes the touch's own guard (`storesClearedForRepair`,
  `src/claude/watchTouchGuard.ts`), so the active plan's store is never refreshed here and can still raise the note, and
  so does every store on a tick whose active plan was only deduced or recorded. A
  rejected or unreadable setup token, or a usage answer the
  gauge cannot read, fires too. A transport failure is unmeasured: it never starts a fault, and never clears one.
- **Once per fault.** A fault is an EPISODE. It starts on the first probe that sees a code on a store and keeps
  its start while the same code repeats. It ends on a probe that reads the plan, on a different code, or when the
  alias moves to another store. The card's key is the alias plus a digest of the store, the code and the
  episode's start. A hundred probes seeing the same fault post one card, and a fault that clears and comes back
  is a new card.
- **One answer never floats.** A fault read off the provider's answer (`CREDENTIAL_REJECTED`,
  `SETUP_TOKEN_REJECTED`, `USAGE_SHAPE_CHANGED`) floats only once a later probe confirms its episode
  (`isUnconfirmedFault`, `src/claude/planProbeRecord.ts`): a network in trouble answers with no rate-limit headers,
  which reads as a usage answer of a new shape. Until then the plan is a blind spot that no stale card drops, and a
  firing reading beside it preserves departures, so one outage-shaped answer neither posts a card nor settles a
  confirmed one. A fault read off the disk (`STORE_MISSING`, `STORE_NOT_READY`, `SETUP_TOKEN_UNREADABLE`) floats on
  the probe that saw it. Two probes are not independent evidence: an outage spanning both still floats.
- **The card.** _Sign in as `<email>` on Claude (`<alias>`) — paste the copied command into your terminal_, with
  `CLAUDE_SECURESTORAGE_CONFIG_DIR=<store> claude auth login --email <email>` on the owner's pasteboard, `work` context,
  `floats`, one per plan. It declares `keepsNoteUp`: a note that failed to come up, or went down without the owner's press,
  is raised again on the next fired pass while the fault stands (`src/monitor/noticeReraise.ts`). Done and Later
  are not undone. The command binds the REGISTER's store, never the `claude signin` wrapper, which re-reads
  the `accounts.json` projection and signs a stale store in once that diverges. A row caching no address is named by
  its store directory, never its alias alone. A setup-token or usage-shape fault asks the owner to ask for the repair
  on the card itself, _Ask on this card for a new setup token for `<email>` on Claude, so the plan works again_ (or
  _a usage reader fix_): a steer spoken with the card open reaches the chair naming the card, and `where` names this
  card on the Queue. It never claims a repair is already running, because nothing starts one on its own, never names
  the fleet as the actor (`src/hand/step.ts`), and never dictates words for the owner to type into a session, which
  the posting form refuses (`src/hand/typedInstruction.ts`).
- **And one card for the register itself.** A plans register that does not read (`REGISTER_UNREADABLE`,
  `REGISTER_INVALID`, `REGISTER_STORE_UNAVAILABLE`) fails every spawn closed (`src/claude/spawnStore.ts`), so the
  pass that sees it fires ONE card, _Ask on this card for a plans register repair — `<what failed>`_ (fail closed, but let the
  user know early). A store merely BEHIND by a landed, additive
  migration never reaches it: the door catches that store up before the read (it once bricked every
  boot for five minutes; [the lifecycle](../../../docs/store/lifecycle-and-schema.md)). It is keyed by the fault (a path, the sorted problems,
  or the outage's code), so the same fault seen a hundred times is one card. With no register there are no plans to
  judge, so the reading PRESERVES DEPARTURES: a plan's own card is neither settled nor replaced by it, and the
  register card settles on the first MEASURED pass that reads the register again — one whose probe row and hand
  register read too, since an unmeasurable pass settles nothing; the probe row lives in the same store,
  so that wait is one pass at most in practice, and spawns recover at once regardless. The owner's Done is not held here — every pass
  re-reads the register, so a pass after the owner's Done that still cannot read it puts the card back up. A watch whose
  own register read fails fires this pass too, opening or between ticks, unless `--dry-run`. **The CHAIR hears it
  too**, because the card reaches only the owner's screen: the courier types one wake line per register card, and the
  next tick leads with BOOTS REFUSED ([boots refused](../../supervisor/reference/boots-refused.md)).
- **The owner's Done is held, not believed.** A card the owner closed after the last probe that saw the fault is held until a
  probe re-tests the plan. That probe either reads the plan, which clears the card, or confirms the fault after
  the owner's Done, which posts a new card.
- **Paused is the owner's answer.** A paused plan is not read, and an open card on one settles. `claude gauge --plan` on a
  paused plan still prints its reading but records nothing, so a probe taken during the pause cannot fire on resume.
- **When it fires.** The keep-alive fires the pass itself on every tick it is not `--dry-run`
  (`src/cli/commands/claude/watchTickTail.ts`). The supervisor tick fires it straight after `gauge-report`
  (`src/supervisor/scratch/fleetReadings.ts`). A plan with no record for its current store reads `unmeasurable`,
  never clear — unless a card no current fault backs is open, which that pass settles instead of pinning. One plan
  recovering settles only its own card: a per-subject floating monitor never reads another plan's standing card as a
  returned set (`src/monitor/openCards.ts`), and another plan's held Done never keeps it up (`src/monitor/pass.ts`).
- **Two producers, one card.** Every fired `monitor check` pass holds the home's fired-pass lease
  (`src/monitor/firedPassLock.ts`) from its Done reconciliation to its last settle. So the keep-alive and the
  chair firing at once cannot both read "no card open" and post the same fault twice. A rehearsal takes no lease.
  A dead holder is reclaimed at once; a live one past five minutes is taken over, and the overtaken pass is FENCED:
  it checks its lease before each monitor's writes and writes nothing more once it lost it. The guarantee itself sits
  at the append: under the hand register's lock, a monitor card is refused beside any occurrence of itself, open or
  already settled, that its pass never read (`src/monitor/passPost.ts`), so no interleaving posts a second card or
  note.
