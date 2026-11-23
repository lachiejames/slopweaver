# Connecting a plan from the console

Setting up a plan never touches a terminal. Settings → Models' **Connect** is that path, and these are the verbs
under it.

```bash
slopweaver plans connect --provider codex --json   # start one attempt; returns at once
slopweaver plans connections --json                # where each provider's latest attempt stands
slopweaver plans connect-cancel --id <id> --json   # end an attempt still waiting on the owner
```

- **What runs.** `connect` asks Codex's own sign-in (`codex app-server`) for its page, opens it in the browser and
  returns, leaving a background worker that waits for the sign-in and writes the register. No model runs, so rule 2
  is not in play; the owner's sign-in on the provider's page is the consent, and no credential passes through Slopweaver.
- **Where it lands** (`src/plans/connectPlan.ts`). Every Connect signs a fresh store in, under
  `$SLOPWEAVER_HOME/codex-accounts/<alias>` (`codex-1`, `codex-2`, … skipping an alias taken or removed), and adds a
  row of its own. The start creates that store exclusively, skipping any directory already standing, and writes its
  attempt id into `.slopweaver-connect` inside it, so the store a cleanup removes is always one the attempt made; a
  start that cannot write its record removes the store again, and names one it could not remove
  (`CONNECTION_STORE_LEFT_BEHIND`). The worker trusts no record's path: one naming anything but the store a Connect
  reserves for its alias, a store without this attempt's id inside, or a store a row already names, is refused before
  sign-in and never removed (`CONNECTION_STORE_FOREIGN`). Every removal, the start's included, checks the path and
  the id again, renames the store in one step into a holding directory it has just created under a random name
  (`<alias>.retired-<random>/store`, so the rename never lands on anything already there), and only then re-reads the
  register. A row that came to name the store, the holding directory or anything beneath either keeps it, left at
  `<holding>/store` and named in the reason it was kept: a rename back would replace the empty directory a concurrent
  `plans add` makes at the old path. A row committed after the read names a path the removal never touches. What is
  deleted is the holding directory. A Codex login found on the machine is never a plan, so a fresh install has no Codex row to sign in. On an install that has adopted nothing, the worker adopts the
  register as it reads first. An account already connected under another alias is refused (`DUPLICATE_ACCOUNT`), and
  a sign-in that names no account is refused too (`ACCOUNT_UNKNOWN`), since it cannot be checked for a twin. Every
  end but `connected` removes the fresh store; a write whose row committed and only a projection lagged is
  `connected`, its words in `detail`.
- **The attempt.** One record per provider under the home (`src/plans/connectionStore.ts`), its phase `starting`,
  `browser`, `connected`, `failed` or `cancelled`, with a closed set of failure codes. The owner has ten minutes to sign in
  (`CONNECT_SIGN_IN_MS`); a second Connect while one is active is refused, and two pressed at once are serialised by
  an exclusive lock (`CONNECTION_STARTING`). The worker registers and writes its final record under the same lock, and
  only while its attempt is still the record, so one finishing after a later Connect replaced it registers and writes
  nothing (`CONNECTION_SUPERSEDED`), removes its store, and names one it could not remove in `worker.log`
  (`CONNECTION_STORE_LEFT_BEHIND`). A reader calls an active attempt past its deadline `INTERRUPTED` without writing
  it down, so a worker that resumes inside a minute of that deadline registers nothing and ends `INTERRUPTED` itself. The deadline bounds the sign-in, so it is judged once, as
  registering begins: a register write that starts in time and finishes after the deadline still ends `connected`.
  The lock is the highest of numbered files
  (`<host>.lock.<n>`), taken by an exclusive create of the next number, so no taker ever moves another's file. A
  holder whose process exited is passed at once, one holding past half an hour is passed as hung and then writes
  nothing.
- **What it does not cover** A holder suspended past that half hour in the instant between
  checking its lock and writing can still land one record after the taker's, so two attempts may each have started.
  And the register and the attempt record are two stores: a worker killed after its row commits and before its
  record is written leaves a working plan beside a record that reads active, then `INTERRUPTED` at its deadline.
  The Models section still lists the plan, and nothing removes its store. A worker that cannot take the record's lock in
  its minute of waiting, because a live process holds it, writes no end: the attempt reads active until its deadline,
  then `INTERRUPTED`. The reservation is a file inside the store, not the directory's identity, so a process of the
  same user swapping its own directory in between the store's creation and that file's write has it marked as the
  attempt's, and removed at its end. And one unreadable attempt record, of either provider, fails `plans connections`
  whole rather than listing the other.
- **Claude.** `--provider claude` answers that it is not built yet; the console draws Claude's Connect disabled and
  says so. A Claude plan is still added with `plans add` and `claude signin`.

The console's side — the cards, the live row and its words — is
[the settings page](../../../site/content/console/settings.mdx).
