# A first boot: the profile hold on a machine the owner's profile never reached

Part of [The local Supabase store](../store.md), the exception to the profile hold in
[the owner's own tables](owner-registers-and-roles.md). A profile that exists
and did not load is held; with none yet, holding is self-imposed hardship, and onboarding must never require any
particular integration or trap anyone.

## What counts as the owner's profile having existed

A machine is a **first boot** when neither the resolved home nor `~/.slopweaver`, under `$HOME` and under the
account's own home as the user database names it (`machineDefaultHomes`; no entry there holds), carries any trace of
the owner's PROFILE:

- `profile/owner-written`, which `profile set` leaves in every home BEFORE the row, under one lock in the account's own
  home: it marks its own session as a first-boot one and refuses the row unless that mark and the owner mark land in
  every home, publishes each mark whole (staged, then renamed into place under the lock, which an exFAT home takes too), and when the row fails retracts the marks it
  made only once a re-read proves no row exists. A mark names the fingerprint of every store a row was written to, one per line, synced before it is renamed into
  place, and every live load (`profile context`, the SessionStart hook, the prompt-time check) withdraws the store it reads live and finds empty (removing the file once it names none) under the same lock — a lease never aged out while
  its holder lives — so a `profile set` killed between mark and row cannot hold a fresh machine (`src/admit/ownerProfileWritten.ts`);
- a cached context, `profile/context.json` or `.txt`, cached only by a live read that found the owner's row (`src/context/load.ts`);
- a delivery marker under `profile/delivered/`;
- a `live` or `cache` row in the load ledger, unless it carries `ownerAbsent`: a live read that found no owner row is
  no evidence a profile existed (`src/context/loadLedger.ts`).

A selected store is NO trace: onboarding selects one (`yarn store:start`'s lock writes `store-url`) before `store push` makes its schema.
An unreadable trace counts as present; a plain file above one, or where the delivery directory belongs, as absent
(`src/admit/profileFirstBoot.ts`).

## What a first boot changes

EVERY call runs, and nothing is delivered or recorded: the PreToolUse hold, `profile context`, the SessionStart hook,
the prompt-time check and the `profile-unloaded` monitor all let it through, and every block carries `# FIRST BOOT`
(`FIRST_BOOT_LINES`, `src/context/loadLedger.ts`). A live read that finds no owner row caches nothing and, on such a
machine, is a first boot too. The door's `PROFILE_NOT_LOADED` hold opens on the same evidence
(`src/admit/profileLoadGate.ts`) and holds a first-boot session (`profile/first-boot/<id>`, marked in every home read)
once a profile it never loaded exists. The PreToolUse hold and the session-start hook both mark a session they find on a first boot, best-effort, and never
through a link; the session that runs `profile set` is marked by
`profile set` itself, which refuses without it.

A first boot writes no ledger row anywhere, so the bash recovery lane (`profile_first_boot`,
`hooks/lib/profile-delivered.sh`) reads the same evidence with no node and counts ANY ledger as configured, since it
decodes no JSON: stricter than node, never looser. It folds every home as node's `resolve` and `homedir()` do, reads
a home as blank exactly when JavaScript's `trim` would, and runs every command through `command -p`, never `$PATH`.

## Residue, accepted by that ruling

"No surviving evidence" is all a disk can say, so a machine whose every trace was deleted reads as fresh. The evidence
is the HOOK's environment, so a call whose own command re-points itself at a configured home (`SLOPWEAVER_HOME=…`,
`--home`) or runs as another account (`sudo -u`) is not judged against that home; likewise a `profile set` whose
environment names no session (a plain terminal, or a call that unsets the session variables) marks none. A call judged while another is
writing the first trace can still run, the gap every PreToolUse verdict has. A profile restored by SQL or written by
hand leaves no mark until a load caches it. A session whose hook-time mark failed (a full disk, say)
is, once ANOTHER session configures the machine, held by PreToolUse on its next guarded call but not by the door: a
door write with no PreToolUse in front of it reads that session unobserved, which main's door passes for every
session. Holding a call whose mark failed instead traps a fresh machine on a full disk. On a machine already traced, a live read finding no owner row is recorded and
delivered as a load, as on main, so a session that then runs `profile set` itself is not held for the row it wrote:
refusing to record that read would hold such a machine with nothing to load. A failed row write whose re-read also fails keeps its marks until
`profile context` reads the store empty. The bash lane runs its own commands through `command -p`, but the shim
around it finds itself and reads its payload through `$PATH` (`dirname`, `cat`), as it does on main for every machine. A
`none` or `ownerAbsent` ledger row, from an older version or from a hook that fired while a failing or killed `profile set` held its
marks, holds only the bash lane (an older version's owner-absent read carries no `ownerAbsent` and counts on node too), which decides only when no node gate can run; node opens it. A home with a plain file
where `profile` belongs reads fresh but takes no mark, so `profile set` refuses there, naming the home; nothing is
held meanwhile, and slopweaver never deletes the file itself.
