/**
 * Which invocations of a migration tool APPLY or REVERT a migration — the half of the bot-turn live-write
 * guard the rule names first: the bot never runs a migration at all unless the owner explicitly asks it
 * to.
 *
 * "At all" is why no table here asks which database a command points at: a migration against a throwaway
 * local database is refused exactly like one against production, and the hatch is the owner's explicit ask. What a
 * table DOES leave alone is a form that only authors or inspects — `prisma migrate status`, `drizzle-kit
 * generate`, `rails db:migrate:status`, `alembic history` — because reading and reporting is the safe lane the
 * rule names in the same breath.
 *
 * Pure: a program's name and its argument words in, a finding or nothing out.
 */
import { anyMatching, anyOf, either, pairOf, ruleInput, type WriteRule } from "./liveWriteRules.js";
import type { LiveWriteFinding } from "./liveWriteTypes.js";

const DJANGO_VERBS = ["migrate", "flush", "loaddata"];

/** Every migration tool this guard knows, keyed by the name its program runs under. */
const MIGRATION_RULES: Readonly<Record<string, WriteRule>> = {
  alembic: anyOf({ verbs: ["upgrade", "downgrade", "stamp"] }),
  atlas: pairOf({ group: ["migrate", "schema"], verbs: ["apply", "down", "clean"] }),
  "db-migrate": anyOf({ verbs: ["up", "down", "reset"] }),
  dbmate: anyOf({ verbs: ["up", "migrate", "rollback", "down", "drop"] }),
  diesel: either(
    pairOf({ group: ["migration"], verbs: ["run", "revert", "redo"] }),
    pairOf({ group: ["database"], verbs: ["reset", "setup"] }),
  ),
  "django-admin": anyOf({ verbs: DJANGO_VERBS }),
  "drizzle-kit": anyOf({ verbs: ["migrate", "push"] }),
  flyway: anyOf({ verbs: ["migrate", "clean", "baseline", "repair", "undo"] }),
  goose: anyOf({ verbs: ["up", "up-by-one", "up-to", "down", "down-to", "redo", "reset"] }),
  knex: anyMatching({ pattern: /^migrate:(?:latest|up|down|rollback)$/ }),
  liquibase: anyMatching({ pattern: /^(?:update(?:-count|-to-tag|Count|ToTag)?|rollback\w*|drop-?all|dropAll)$/i }),
  migrate: anyOf({ verbs: ["up", "down", "goto", "force", "drop"] }),
  "mikro-orm": anyMatching({ pattern: /^(?:migration:(?:up|down|fresh)|schema:(?:update|drop|fresh|create))$/ }),
  "node-pg-migrate": anyOf({ verbs: ["up", "down", "redo"] }),
  prisma: either(
    pairOf({ group: ["migrate"], verbs: ["deploy", "dev", "reset", "resolve"] }),
    pairOf({ group: ["db"], verbs: ["push"] }),
  ),
  rails: anyMatching({
    pattern: /^db:(?:migrate(?!:status)\S*|rollback|schema:load|structure:load|setup|reset|drop|prepare|purge)$/,
  }),
  sequelize: anyMatching({ pattern: /^db:migrate(?!:status)\S*$/ }),
  sqlx: either(
    pairOf({ group: ["migrate"], verbs: ["run", "revert"] }),
    pairOf({ group: ["database"], verbs: ["reset", "drop", "setup", "create"] }),
  ),
  supabase: either(
    pairOf({ group: ["db"], verbs: ["push", "reset"] }),
    pairOf({ group: ["migration"], verbs: ["up", "down", "repair"] }),
  ),
  typeorm: anyMatching({ pattern: /^(?:migration:(?:run|revert)|schema:(?:sync|drop))$/ }),
  wrangler: pairOf({ group: ["migrations"], verbs: ["apply"] }),
};

/** The names a table entry also answers to — the same tool under a second binary name. */
const ALIASES: Readonly<Record<string, string>> = {
  rake: "rails",
  "sequelize-cli": "sequelize",
  "typeorm-ts-node-commonjs": "typeorm",
  "typeorm-ts-node-esm": "typeorm",
};

const PYTHON = /^python(?:\d+(?:\.\d+)*)?$/;

/**
 * Whether a package script's NAME says it applies migrations — `migrate`, `db:migrate`, `migrations:run` — and
 * not that it only authors or inspects one (`migration:generate`, `migrate:status`, `test:migrations`).
 *
 * A name is the only evidence a hook has: the script body lives in a `package.json` this pure function never
 * reads. So a script called `deploy-db` that migrates is invisible, and that is stated residue, not a guess.
 *
 * @param script the script or target name as typed
 * @returns whether the name reads as running a migration
 */
export function scriptRunsMigration({ script }: { script: string }): boolean {
  return /migrat/i.test(script) && !/generate|create|new|status|make|diff|check|lint|test|show|list/i.test(script);
}

/**
 * The migration one program invocation would apply, if any.
 *
 * @param name the program's own name (`programName`'s answer)
 * @param args the words after the program, redirections removed
 * @returns the finding, or `undefined` when the invocation applies no migration
 */
export function migrationFinding({
  name,
  args,
}: {
  name: string;
  args: readonly string[];
}): LiveWriteFinding | undefined {
  const input = ruleInput({ args });
  const [script, verb] = input.positional;
  const django = script !== undefined && verb !== undefined && script.endsWith("manage.py");
  if (PYTHON.test(name) && django && DJANGO_VERBS.includes(verb)) {
    return { kind: "migration", operation: `manage.py ${verb}`, tool: name };
  }
  const tool = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
  const rule = Object.hasOwn(MIGRATION_RULES, tool) ? MIGRATION_RULES[tool] : undefined;
  const operation = rule?.(input);
  return operation === undefined ? undefined : { kind: "migration", operation, tool: name };
}
