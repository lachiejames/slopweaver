# Demand-gated resyncs: walk only when a person asked

A sign-in note asks the owner only when a sync would be useful: when more pen-testing happened, or someone
mentioned work in the app recently.

The shape it answers: a pen-test platform's findings arrive in bursts, one engagement at a time, and between
engagements the provider side barely changes, so a walk on a fixed cadence reads nothing new on almost every day
it runs — while any walk that meets the sign-in page still stops and asks for the owner's.

## The mechanism

- **Declared on the descriptor.** `resyncDemand: { terms, because }` (`src/atlas/kit/contract.ts`). Aether
  declares `aether` and `dvuln`. An atlas without it walks on its cadence exactly as before.
- **Checked before any step runs.** `automation resync` asks `src/live/resync/demandRead.ts` whether a PERSON
  has named a term since the atlas's last success. It searches the store full-text in `slack`, `linear`,
  `notion`, `gmail`, `calendar` and `fathom` only, human-only, minus the fleet's own Slack ids from
  `profile.json`'s `slackBot`. `github` is excluded because the fleet's own pull requests name every atlas
  they touch, and `self` because it is this repository's own scan. Each term pages back newest first until a
  page holds a person's mention, runs short, or reaches the last success, so the fleet's own posts never hide
  an older one. Every page reads one `repeatable read` snapshot, so a store write between pages cannot shift one.
- **Three answers, three exits.**
  - No demand: _NOTHING TO DO_, exit 3. No step runs, no browser opens, no record is written, the slot is
    stamped and the row reads healthy.
  - The check could not read (no store selected, the store did not answer, a profile that is corrupt or names
    no non-blank `slackBot` ids, a last success or a hit whose time does not parse, a hit with no link, or 200
    records naming one term in one source since the last success with none a person's, past which that
    search stops paging): _DEFERRED_,
    exit 4. The slot stays due. It never walks on a guess, because that would re-create the ask.
  - Demand found: _WANTED by `<who>`_, then the walk runs as any resync does. The attempt stores the mention
    as `demand`.
- **Judged against the last SUCCESS, never the last attempt.** A demand walk that meets the sign-in page leaves
  the demand standing. The seat holds the row on the owner's card (_AWAITING SIGN-IN_) and walks again once the owner
  presses Done. Judged against the walled attempt, the owner's Done would re-walk nothing.
- **The row stays SEATED.** A gated atlas is not compile-only, and moving its row to the tick would put a walk of
  the owner's Chrome into an unattended process (`isCompileOnlyDescriptor`'s own warning). A seat batches resync rows, so
  a no-demand day costs one command that exits 3.

## What the owner sees

- **Nothing**, on every day nobody named it.
- **On a demand day whose walk meets the sign-in page**, one `mon-signin-<host>` card. Its if-ignored line says
  who named it and when, and the mention's link is behind Details
  ([the card](../../monitor/reference/resync-signed-out.md)). The owner judges whether the stored read already answers
  them.

## Residue

The terms are words, not intent. A message that merely says "aether" counts. That is the right direction:
one ask the owner can wave off beats a daily one. A message that describes a new engagement without either word does
not count. Add the word to `terms` when one appears. A post the store attributes to THE OWNER and does not flag as a
bot counts as the owner's mention: one the fleet sends as the owner (`--as me`, a Linear issue under the owner's token),
or one from a bot `profile.json`'s me-to-me resolution rewrites to the owner's id without a bot flag. The store cannot
tell either from one the owner typed, and excluding the owner's id would silence every mention the owner makes. A row the store flags as a bot
never counts, whoever it names. The
store reports a hit's time to the second, so a mention in the same second as the last success counts too. A
record naming nobody, such as a Notion database row an automation wrote, never counts: it is no evidence a
person asked. The fleet's own Slack users are exactly what `profile.json`'s `slackBot` lists, so a fleet
account missing from it counts as a person. Add it there.

The briefing's freshness section (`src/briefing/freshness.ts`) judges a gated atlas against its 36h window,
so Aether reads _late_ between demand days. That is true of the data, and it raises no card.
