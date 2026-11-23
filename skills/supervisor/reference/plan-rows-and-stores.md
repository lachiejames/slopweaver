# A plan's ROW, its store, and taking one out of the fleet

Which plan a spawn spends is [plan-routing](plan-routing.md). This page is the row underneath that decision:
where a plan's credential store lives, why its name is load-bearing, and how a plan that cannot be spent is
taken out without being deleted. The two topics are one topic — both turn on the alias BEING the directory.

## A plan nobody can repair is PAUSED, not left in the rotation to fail

```bash
slopweaver claude pause plan-one --reason "claude.ai subscription paused on a bounced Airwallex charge"
slopweaver claude resume plan-one
```

The pause writes `paused: { reason, sinceIso }` onto that plan's row in `accounts.json`, and the three places
config becomes a probe list — the routing gate, the fleet-wide `claude gauge` read and the `claude watch`
loop — skip it and print its reason once instead. Asking for it **by name** (`claude gauge --plan <alias>`,
`rotate`, `signin`, `token`) still reads it, which is how "is it back yet" is answered without resuming first.

Three properties are the design rather than notes:

- **A reason is REQUIRED and there is no date to return on.** A plan waiting on another person's approval has
  no known return, and a countdown on somebody else's decision is a deadline the fleet invented. The row
  carries what it is out for and when it went out, and that is what makes a forgotten pause visible.
- **It is never a deletion.** A plan's alias IS its store directory name and `storeService.ts` hashes that
  path into Claude Code's keychain service, so a row that leaves and comes back is a RE-ENROLLMENT. Pausing
  touches no credential at all.
- **`parseClaudeAccounts` decides whether the result is publishable, and nothing else does.** Pausing the
  pinned plan is refused by that one validating reader and nothing is written; the refusal names the plan and
  what to do first. There is no count rule: one Claude row is a whole fleet, and pausing the last live plan
  lands, after which every unpinned spawn refuses as `paused` until a `claude resume`. A pinned spawn whose
  own plan is paused refuses as `paused` too, never as the hatchable unreadable-plan.

Without it, an unrepairable plan costs one probe and one doomed repair on EVERY spawn, a red line no reader
can act on, and `acceptance: UNMEASURABLE` forever — `acceptanceShortfall` grades the fleet unread whenever a
configured plan returned no gauge.

## Where a plan's store lives, and why a rename strands it

What the sign-in walk provisioned IS the convention. The owner does not adjudicate the internals, only the
outcome: **the owner should not have to sign in again to any of the four plans for at least a
week.**

A plan's store is `$SLOPWEAVER_HOME/claude-accounts/<alias>`, mode `0700`, no `pinned` key except on the one
pinned plan. MEASURED: all four configured stores match it exactly.

**A RENAME IS A RE-ENROLLMENT.** The alias is the directory name, and
[storeService.ts](../../../src/claude/storeService.ts) derives the keychain service by hashing that PATH. So
renaming a plan addresses a different, empty keychain item while the credential lingers under the old hash.
Renaming as a tidy-up is a silent way to strand a signed-in account, which is the class this whole feature
exists to close.

`conventionalStoreDir` and `storeDirDepartures` ([config.ts](../../../src/claude/config.ts)) make this
checkable rather than prose. They REPORT and never refuse: a store elsewhere still works, so a gate that
refused one would take a working fleet down over a naming preference.

**One residue worth knowing before you read a watch tick.** The GATE attempts no refresh when the network is
down, and neither does the watch's repair, which is the same `probeRepair.ts` entered after the tick has named
the active plan, so it never refreshes the store the fleet is running on. The watch's TOUCH is a
different mechanism: it reads a due store's own expiry and runs the refresh once the token is inside the CLI's
five-minute window, independently of any gauge, so an offline tick can still run one doomed refresh per store
in that window. A touch counts only when the store's expiry moved forward ([keepAliveTouch.ts](../../../src/claude/keepAliveTouch.ts)).

**Every watch tick also checks each live store's account against its enrollment**, and leads its stderr with
`<alias>: WRONG ACCOUNT — …` or `<alias>: DUPLICATE — …` in `claude signin --status`'s own words, because it
runs the same decider ([watchIdentity.ts](../../../src/claude/watchIdentity.ts)). A store that switched account
used to read `plan drawdown: no anomaly` until a session ran `signin --status`; it now alarms on the next tick.
It compares only the stores it probes, so a paused or monthly plan that switched account still needs
`signin --status`.
