# Claude plan rotation — the active plan and its accounts

Part of [Architecture](../architecture.md), continuing [Claude plan rotation](claude-plan-rotation.md).

- **The active plan's budget is read from the ACTIVE SLOT, not from its store.** The active plan's own store
  is the one a probe cannot read, because the slot has refreshed past the credential the store still holds.
  MEASURED: `plan-two` and `plan-three` answered 200 while the plan the fleet was running on
  answered 401. A loop reading only the stores is therefore blind to the one gauge that decides whether to
  rotate, so the loop probes the active slot too and stamps that reading with the plan it resolved.
- **Which plan is active is answered by the ACCOUNT, from a header the gauge probe already collected.**
  Every ordinary `POST /v1/messages` response carries `anthropic-organization-id`. `checkoutIdentity.ts`
  records it per store and matches the active slot against them, and where every store but one has answered
  it deduces the remaining one. Unlike a byte comparison, an account survives a token refresh.
  The value is a private identifier, so it lives only under `$SLOPWEAVER_HOME` and reaches no rendered
  document.
- **The loop must never touch a store whose credential the ACTIVE slot is also holding**, and the recorded
  alias is the weak half of that guard. A store and the active slot holding the same token revoke each
  other on a refresh under either — the loop built to prevent an outage manufacturing one. MEASURED: three stores were configured and `rotation-state.json` did not
  exist at all, so a guard resting on `state.selected` alone excluded nothing. The strong half compares the
  documents directly, needs no record, and correctly held the active store out on the first live run.
- **When the loop cannot identify the active plan, it touches NOTHING.** MEASURED on merged `main`,
  which is what put this rule in: both existing guards were inert at the
  same instant. The credential comparison is exact, so it holds only while a store and the active slot carry
  the identical token, and ordinary use had already refreshed the active slot away from every store's copy
  (active reading 6.34 hours of life while two stores read EXPIRED); `rotation-state.json` did not exist, so
  the alias guard covered nothing either. Every store was listed as due, including the one whose ACCOUNT the
  active slot holds — and touching that store refreshes it from its own refresh token, which revokes the
  sibling copy every running session is authenticating with. A needless delay costs one interval; a wrong
  touch costs the outage the feature exists to prevent. Comparing ACCOUNTS rather than bytes is what settles
  it (`checkoutIdentity.ts`, above).
- **Which plan is active is OBSERVED, and the record is only the fallback.** The store whose credential the
  active slot holds is a checkable fact; the record (`rotation-state.json`'s `selected`) is absent on a fresh
  install and stale the moment the owner signs in by hand. A tick reports which of the two answered.
- **The STRONGEST answer is the store the watch process is itself pinned to, and it outranks every probe.**
  Every other answer reasons about "the active slot" — the DEFAULT keychain item. On this machine nothing
  runs on it: every session is booted with `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming one store
  (`seatPinning.ts`), so that item holds whatever a hand `/login` last left there. MEASURED, and
  it is what put this answer in: the default item's `mdat` was two days stale, so its
  token had long expired. `probeActiveSlot` presented it, got a `401` and returned no organisation,
  which takes `identified` AND `deduced` out at once because both are gated on that value; the byte
  comparison reads the same dead item, so `observed` matched nothing either. Resolution fell all the way to
  `recorded`, which had said `plan-three` for five days. The tick skipped plan-three as
  self-refreshing while every session ran on plan-one — protecting the one store that needed nothing, and
  leaving three that expired within three minutes of each other, exactly eight hours after their sign-ins. The pin
  needs no probe, no record and no deduction, and cannot go stale. `config.ts`'s `aliasForStoreDir`
  compares paths the way the keychain does — exact string equality after NFC, never `realpath`, because
  the service name hashes the path AS GIVEN and two spellings are two different credentials.
- **The RECORDED answer expires with the credential it describes.** An access token does not survive
  `ACCESS_TOKEN_LIFETIME_HOURS` without being refreshed or replaced, so a record older than one lifetime
  describes a credential that is gone. Past that bound the tick
  answers `unknown` and touches NOTHING, which is strictly safer than the five-day-old record above: a
  wrong `recorded` both protects the wrong store and clears every other store — including whichever one is
  genuinely live — for a touch.
- **A slot holding NOTHING is `none`, not `unknown`, and that distinction is why keep-alive works at all.**
  "Touch nothing when no plan can be named" swallowed two different states: the active credential is one the
  fleet has never seen, and there is no active credential. MEASURED five days after the pin
  above landed: the default item's token was still expired — the same dead item that
  measurement named, never signed back in — while all four configured stores held live ones. The standing
  loop runs UNPINNED (started from the main checkout with no `CLAUDE_SECURESTORAGE_CONFIG_DIR`), so `pinned`
  did not answer for it and every weaker source is evidence about that dead item. Every tick concluded
  `unknown`, `unknown` holds EVERY store back, and the loop whose one job is keeping four stores alive
  refreshed none of them for seven days — guarding a credential no session could present. So the ladder
  asks whether the slot holds anything BEFORE asking which plan holds it: `classifyActiveSlot` reads the
  slot's own credential and `none` is a POSITIVE finding rather than a fall-through. It sits directly under
  `pinned`, above every inference, since a dead slot can still byte-match a store that died beside it and
  `observed` would then name that store the active plan and hold it back as self-refreshing under a session
  that does not exist. **It releases the BLANKET hold and nothing else.** That hold rests on "any store
  could be the one whose account the active slot holds", which a dead slot has answered: it holds nobody's.
  The byte comparison is a different claim and survives — review pass r1
  (`dead-slot-release-cannot-revoke-a-live-token`) falsified releasing it, because an `expired` reading is
  of the ACCESS token while the REFRESH grant beside it runs 27-29 days, so a store byte-matching a dead
  slot can still hold a grant that slot could have used, and a touch would revoke it. On the measured
  machine `sharesActiveCredential` is empty, so all four stores are released either way. An unreadable expiry
  reads as `live`: the value of `none` is that it was established, never assumed. `ActiveSlot` is a UNION
  rather than an interface with an optional instant, because review pass r2
  (`none-is-established-never-assumed`) falsified the weaker shape — it type-checked `{ holding: "live",
expiryIso: X }` and an `expired` carrying none, while its own doc claimed it could not. The residue is
  stated rather than claimed away: `expired` plus an instant that has not passed stays expressible, since
  catching it needs a second clock and `classifyActiveSlot` is the one producer. The tick line names the
  instant the slot went dead rather than only that nothing could be identified — seven days of "no plan
  could be identified as active" told a reader the loop was stuck and never why. Reproduce the standing
  loop's own view with `env -u CLAUDE_SECURESTORAGE_CONFIG_DIR ./bin/slopweaver claude watch --once
--dry-run`.
- **A tick's rotation is a RECOMMENDATION, and both scopes are reported.** Nothing is performed, so a
  pinned tick's budgets cannot decide on one account and write to another, and a reader on a pinned machine
  gets the recommendation with its scope attached. `WatchTickPlan.rotationScope` names the surface
  (`default-slot` / `process-pinned`) and the shell reads that field rather than re-deriving it, because the
  reader has to be able to judge which store's budgets a recommendation came from.
  The active slot's own gauge is likewise not stamped onto a pinned alias — that would judge one account's
  headroom under another account's name. Found by the Codex pairing pass rather than by an incident, which is
  the point of rule 9.
- **The keep-alive is a STANDING SESSION, graded beside the loop, the scheduler and the supervisor.** It
  was correct and landed and nothing was RUNNING it, which is a
  gap no store gauge can see: `keep-alive.json` says when each store was last touched and cannot tell "the
  loop is running and nothing was due" from "no loop has run since Friday". So `claude watch` stamps a
  record about ITSELF at the start of every tick (`claude/watchSession.ts`), and `session standing` reads
  it as a fourth half RECONCILED against one fallible process-table snapshot: the record names one run, the
  table every running watch (a tsx launcher and its node child counted once). The recorded run's own
  process with a tick inside two intervals is `watching`; a running watch the record does not name is
  `unrecorded` and still live; every second writer is listed in `duplicates` and makes the sweep non-clear;
  an unreadable table is `unmeasured`, never absence; and freshness grades every running checkout. Every
  judgement reads `ps` argv, which joins arguments with spaces, so an argument or checkout path that itself
  contains whitespace is unsupported — residue the code states, not a case it guesses at. It is a
  foreground loop in a visible session and must never become a scheduled job; the record is what makes its
  ABSENCE measurable. MEASURED against the honest alternative — the supervisor's own sweep
  running `claude watch --once` each tick — over 1,872 events, about eighteen days, in
  `$SLOPWEAVER_HOME/live/events/stream.jsonl`: **26 gaps of 2h40m or more** (the
  touch interval) and **7 gaps of 8 hours or more** (the whole token lifetime), the largest 16.70h. The
  sweep does not meet the TTL, and a dedicated session does.
- **The keep-alive command is a REPAIR, not a prolongation, and a tick reports what it DID rather than what
  it achieved.** MEASURED by running the loop against the real stores and reading the keychain
  either side: a tick reported three stores "refreshed" while the modification date on every one had not
  moved. Nothing was broken — the command correctly does nothing to a credential that is still healthy (all
  three had 2.3-4.1 hours of life left). So the value of the interval is that it bounds REPAIR LATENCY: a
  store that expires is brought back within one interval, not that touching postpones expiry. A tick
  says it TOUCHED a store and prints each store's own `expiresAt` beside it, which is the falsifiable
  witness and the number the owner actually wants.
- **ETA-TO-RECOVER is reported with its unknown parts NAMED, never folded into zero.** Detection plus the
  switch plus pickup; only detection is under this code's control, so the loop reports one tick interval as
  its worst case and states plainly that it measured neither of the other two. A total appears only when
  every part is known.
- **The RESERVED plan and the PINNED plan are the same plan, ordered last rather than excluded.** Owner ruling:
  Claude in Chrome is pinned to a single account permanently, because the extension follows
  whichever account the browser's own Claude session holds. The fleet drains every other plan first and
  falls back to the reserved one only when nothing else is eligible — excluding it outright would turn
  "the other two are spent" into a fleet-wide stall while a good plan sat idle.
- **Nothing here WRITES a credential, and a writer meets three measured traps** (`src/claude/keychain.ts`
  keeps them). A `security -i` stdin line past about 4032 characters is TRUNCATED SILENTLY: MEASURED,
  a 2008-byte document became a 4095-char line, decoded to JSON missing `claudeAiOauth`, and every
  session went unauthenticated until the owner signed in by hand — so argv is the fallback, a momentary `ps`
  exposure being the smaller harm. A read-back verifier DETECTS a bad write and cannot undo one, so a writer
  needs a rollback. And the keychain document holds an `mcpOAuth` map beside `claudeAiOauth`, so a writer
  replaces ONE key and carries every sibling through (`credentialDocument.ts`). The read uses
  `execFileSync` only, which the `no-headless` gate permits because it blocks, and returns no credential.
- **It reports on the existing supervisor stream, and nowhere else.** `claude-rotation` is a source on that
  stream's own closed union, so `events tail --min-severity alert` catches an exhaustion without a second
  channel existing. `rotated` is `info`; `all-exhausted` and `gauge-unreadable` are `alert`, because neither
  clears itself on the next tick — one waits on a provider reset, the other means rotation has stopped
  choosing rather than guessing. A decision to STAY publishes nothing, so the stream carries no per-cycle
  noise for a reader to learn to skim past.
- **Readiness is a keychain-metadata question, never a model invocation.** `storeService.ts` derives the
  service name a store's item is filed under, so `security find-generic-password` WITHOUT `-w` answers
  "is this plan signed in" from metadata alone. Running the vendor's own `claude auth status` would answer
  the same question and would arguably be permitted, since it starts no model; choosing the weaker
  capability that still answers it is the point.
- **The rotation state record, not `~/.claude.json`, is the identity authority.** That file's
  `oauthAccount` block is a display cache that does not follow the store a session boots on, so a briefing that read
  it would confidently name the wrong plan. `rotationState.ts` also holds a refused plan out until the reset
  the refusal named, which is what stops two plans near the wall handing the fleet back and forth.
- **An account is a neutral local alias plus a store directory.** The directory becomes
  `CLAUDE_SECURESTORAGE_CONFIG_DIR`, from which Claude Code derives its own keychain service name, so a plan
  is selected by naming a directory and **no token is ever read, copied or held here**.
