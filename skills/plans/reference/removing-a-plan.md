# Removing a plan, and the edits around it

Every plan edit has a verb. Dropping from two personal plans to one must not break the setup, and removing any
Claude or Codex plan must work. Each step below is one verb, refused with its reason when it would change nothing.

```bash
slopweaver plans remove --provider codex --plan codex-two          # take the row off the register
slopweaver plans unpin --provider claude --plan plan-one           # no Claude plan pinned afterwards
slopweaver plans clear-lapse --provider claude --plan plan-two     # the end date was wrong, or it renewed open-ended
slopweaver plans set-email --provider claude --plan plan-two --email owner@example.com
slopweaver plans set-store-dir --provider claude --plan plan-two --store-dir /Users/owner/.claude-two
```

## What `remove` does, and what it does not

- **It takes exactly one row out.** Every other row is kept byte for byte and in order. A pinned row, a paused row
  and a provider's LAST row all remove, because each leaves a register the decoder already accepts: with no
  Claude plan pinned, the publisher seat routes like any other.
- **It is not revocation.** The store directory and its sign-in stay on disk, and a seat already running on the
  row keeps the credentials it booted with until it exits. New work stops being routed there at once.
- **It is refused on an install that has adopted nothing**, like every change but `adopt`, so a removal never
  adopts as a side effect.

Pause instead when the plan is coming back: a pause keeps the row, its usage limit and its lapse date.

## A removed alias comes back only at its own store

Per-plan state outside the register is keyed by ALIAS: usage snapshots, the quota cache and its clear mark,
spend readings, sign-in records, identity assertions, rotation holds. So `remove` records the alias, the store it
named and the instant in the register's `removed` list, and `add` reads that list:

- the same alias at the **same** store restores the row and forgets the removal;
- the same alias at a **different** store is refused, naming the store it may come back at — a different store
  takes a new alias, so no reading of the old account is ever attributed to the new one;
- the same alias under the **other** provider is allowed, because aliases are unique per provider.

## The ambient Codex plan

`codex-ambient` is the row the DERIVED register makes for the ambient `$CODEX_HOME` (`~/.codex` by default).
Once adopted it is an ordinary row: `remove` takes it out and nothing re-derives it, so routing stops sending
work to `~/.codex`.

`codex quota` with no `--plan` reads the row whose store IS the ambient home, by that row's own alias, and
refuses with `EXIT_USAGE` when no row is — so a removed ambient plan is never read under its old name. On a
register read failure it keeps the ambient pair, which is what lets `codex quota --clear` recover mid-outage.

Three paths still use the ambient home whatever the register says, and are not plan routing: `codex gauge` and
`codex signin` report on `$CODEX_HOME` by design, the eval lane (`eval/turnProvider.ts`) runs against it, and the
owner's own terminal `codex` is the CLI's own default.

## A plan signed out mid-fleet

Nothing here changes for it. A signed-out row is excluded from routing on the next read and floats ONE note
([claude-plan-unusable](../../monitor/reference/claude-plan-unusable.md),
[codex-plan-signed-out](../../monitor/reference/codex-plan-signed-out.md)); signing back in clears it. Remove the
row only when the account is gone for good.

## Pinning, lapses and addresses

- **`unpin`** takes the pin off without moving it. A pinned plan cannot be paused, so unpin first when the pinned
  plan is the one going away.
- **`clear-lapse`** drops a recorded end date. `lapse` records over an old one; this is for "there is no end date".
- **`set-email`** corrects the address the register was TOLD. For a Codex store, `sync-accounts` records the
  address the store is actually signed into, and is the better source.

## Moving the same destination

`set-store-dir` re-homes a row at a new absolute path, after a machine move or a renamed user directory, and
keeps its alias, so every reading keyed on it stays attributed. It is for the SAME account moved; a different
account takes a new alias through `add`.

- **The sign-in does not follow the path.** Claude picks its sign-in from the store path, so the moved row is
  signed out until signed in there again. A Codex row's recorded address goes with the old path; sign in, then
  run `sync-accounts`.
- **The path need not exist yet.** Nothing is created, so a move may be registered before its folder is copied.
- **A path naming another row's directory is refused**, through a symlink or another spelling too, exactly as
  `add` refuses it.
