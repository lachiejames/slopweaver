# Staging and prod — the bot diagnoses, it does not fix

Bundled reference for the `loop-bot` skill, linked from SKILL.md § Hard rules, rule 12.

The owner's ruling: the bot should just never run a migration at all unless the owner explicitly asks it
to, and should not take actions on staging or prod generally ever, maybe with the exception of the owner
explicitly asking it to — and even then, usually the owner would not ask it to. Reading and reporting is the
lane the owner called a very important layer of defense.

## The case it was built for

An engineer tags the bot about a failed deploy. The investigation finds the fix is a production migration
rerun. **The answer is the diagnosis**: what failed, why, and the exact command a person with access would
run. The turn does not run it, and does not offer to.

## What counts

- **A migration, run or rerun**, against anything: `prisma migrate deploy`, `rails db:migrate`,
  `alembic upgrade`, `manage.py migrate`, a package script or make target named after one, and the same
  through `docker exec`, `npx`, `cross-env` or `bash -c`.
- **A write to a live system**: `kubectl` and `helm` changes, `terraform apply`, a cloud CLI's non-read
  command, a deploy (`vercel --prod`, `fly deploy`, `wrangler deploy`), a SQL client running a write or a
  SQL file.

Reading stays open and is the job: logs, `describe`, `get`, `migrate status`, a `SELECT`.

## Whose ask opens it

**Only an ask the owner tags the bot with personally.** Another person's request never opens it — not a colleague's,
not one relayed to the bot by someone else, and not a go-ahead recorded on someone else's ask. When the ask
is the owner's and names exactly this run, the session sets `SLOPWEAVER_ALLOW_BOT_LIVE_WRITE=1` on that one command.
Whether a write ask from someone else waits on the owner, and how it shows in the thread, is a separate rule,
not this one.

## The hook, and what it cannot see

`bot-live-write-guard` (`src/admit/botLiveWriteGuardRunner.ts`) runs first in the `PreToolUse` fold for
`Bash` and `Monitor`, and fails closed. It judges only a session that is a dispatched bot turn's announced
worker; the owner's own sessions and the fleet's seats meet nothing new. On a colleague's ask it HOLDS with no
hatch, and on the owner's own ask it names the hatch. A bot-turn state file that is there but unreadable HOLDS too, naming the
file — never read as no bot turn.

SQL, the cloud CLIs, `kubectl`, `helm`, `terraform` and `pulumi` are judged by what READS, so an unlisted
verb refuses. It cannot see: an inline turn, or a worker that never ran `turn resume`; an alias, a function or
a program held in a variable; a shell script run by a path that says nothing about what it does; an SDK write from code; a
read-shaped SQL call with side effects; a hosted-app CLI's write verb its list lacks; anything a tool runs on
its own; a state file deleted or rewritten on this machine. **A hold confirms the command would write. Its absence proves nothing**, so this rule binds
whether or not the hook speaks.
