# The `recipe` alias

The noun is `automation`, and `recipe` is an alias the dispatcher resolves before anything else reads the argv
(`src/cli/nounAliases.ts`), so `recipe` typed where the noun goes runs the same verb and prints exactly what
`automation due` prints. Handover docs, board rows and transcripts on disk spell `recipe`, and a session copies
such a line verbatim, so the alias answers for as long as anything on disk says it. Canon names `automation`;
the stale-reference sweep refuses `recipe` as the noun of a quoted command.

The ruling: everything is called an automation, and nothing may break, since it runs only on the owner's
machine for now.

## What is spelled `recipe`, and why

Every worktree runs its own build against the ONE shared `$SLOPWEAVER_HOME`, so a name written to disk is read
by every build a seat may be running. These are spelled `recipe`, and a renamed one would make an older seat's
build refuse a row it ran yesterday:

- the store directory, `$SLOPWEAVER_HOME/live/recipe/` (definitions, runs, slot attempts, resync state);
- `recipeId` and every other persisted field name in a definition or a run record;
- the `--recipe <id>` flag, which names a row rather than the noun;
- the `recipe:<id>` card keys, the `recipe-failing-*` finding slugs, the `recipe-seat` session kind and the
  `recipe-*` monitor ids such as `recipe-stopped`;
- the argv a managed resync row persists, `["recipe", "resync", …]`, written by
  `src/live/resync/registrationPlan.ts` so every build can route it;
- the `holder` a run-due attempt records, `recipe run-due`.

## Where the alias is read

A reader that judges a persisted argv or a typed command line by its noun resolves the alias rather than
comparing words: the verb-run planner and the resync step check (`verbsOfNoun`, `src/cli/nounGroups.ts`), the
steer and stranded-row checks over a managed row's argv, the run-due deadline gate, and the ruling gates, so a
gate recorded on `recipe run-due` refuses `automation run-due` and the other way round.
