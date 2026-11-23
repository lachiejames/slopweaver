/**
 * Row-level security declared where the table is declared, so it generates into the migration with it.
 *
 * The policies live inside
 * the drizzle tables with `pgPolicy()`, the way the owner's archive has them. The archive's own tables carry
 * their four policies in the `pgTable` call's second argument, and the reason that shape is better than
 * a second file is not tidiness — it is that a table added without a policy becomes visible in the
 * GENERATED DDL a reviewer reads, instead of depending on somebody remembering to add a name to a list
 * in another module. `alter table … enable row level security` denies everything by default, so the
 * failure being prevented is a table nobody can read, discovered at query time.
 *
 * ## What still cannot generate, and why it is not a half-measure
 *
 * Drizzle emits `CREATE POLICY` and `ENABLE ROW LEVEL SECURITY`. It emits no `CREATE ROLE` and no
 * `GRANT`, so the three roles and their grants stay in {@link storeRoleStatements} and the table grants
 * stay in the post-migration set. Drizzle-kit CAN be told to manage roles through `entities.roles`, and
 * that was rejected rather than overlooked: this store's database is a Supabase stack whose own
 * `anon`, `authenticated`, `service_role` and `supabase_admin` roles it does not own, and a role manager
 * pointed at that database generates DROPs for every role it did not declare. The roles are therefore
 * declared here as {@link pgRole} `.existing()` — known to the type system so a policy can reference
 * them, unmanaged by the generator so it never emits DDL for them.
 *
 * ## The ordering this forces on the apply loop
 *
 * `create policy … to slopweaver_owner` fails if that role does not exist, and the roles are not in the
 * migration. So role creation runs BEFORE the migration and everything else after it — see
 * `preMigrationStatements` and `postMigrationStatements` in `../migrate.ts`. That split is a consequence
 * of this file rather than a preference, which is why it is stated here as well as there.
 */
import { type SQL, sql } from "drizzle-orm";
import { type PgPolicy, pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * The owner's role: unrestricted, on every table, for every operation.
 *
 * `.existing()` on all three for the reason the header gives — declared so a policy can name them,
 * never generated, because this database's other roles are Supabase's.
 */
const slopweaverOwnerRole = pgRole("slopweaver_owner").existing();

/** The read-only agent's role: reads everything, granted no write, so no write policy exists for it. */
const slopweaverAgentRole = pgRole("slopweaver_agent").existing();

/** The Slack-facing bot's role: the only one that is denied anything, and the reason RLS is here at all. */
const slopweaverBotRole = pgRole("slopweaver_bot").existing();

/**
 * The three policies every store table carries, with only the bot's predicate varying.
 *
 * Built by one function rather than written out per table so the set cannot drift between tables: a
 * table whose agent policy was quietly omitted would read as fine and be invisible until an agent query
 * returned nothing. The bot's predicate is the single axis that differs, and it is a parameter for
 * exactly that reason.
 *
 * @param table the table name, used to build policy names unique across the schema
 * @param botRead what the bot may see — `visibility = 'public'` on the table with a private lane of its
 *   own, {@link botSeesPublicParent} on a table whose rows hang off that one, {@link botSeesEverything}
 *   on one with nothing private in it, and `false` on a ledger. A table with no private lane still gets a
 *   policy, because RLS-on with no policy is a table nobody can read.
 * @returns the owner, agent and bot policies, in that order
 */
export function storeTablePolicies({ table, botRead }: { table: string; botRead: SQL }): readonly PgPolicy[] {
  return [
    pgPolicy(`${table}_owner_all`, {
      as: "permissive",
      for: "all",
      to: slopweaverOwnerRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
    pgPolicy(`${table}_agent_read`, {
      as: "permissive",
      for: "select",
      to: slopweaverAgentRole,
      using: sql`true`,
    }),
    pgPolicy(`${table}_bot_read`, {
      as: "permissive",
      for: "select",
      to: slopweaverBotRole,
      using: botRead,
    }),
  ];
}

/**
 * The bot predicate for a table with nothing private in it — a person, a container, the owner's profile.
 *
 * Named rather than written as a bare `sql\`true\`` at each call site so the cases read as a choice a
 * table made. It is NOT the predicate for a per-source table: those carry no `visibility` column, but
 * every row of one belongs to a content row that does, and {@link botSeesPublicParent} is what they take.
 *
 * @returns a predicate that admits every row
 */
export function botSeesEverything(): SQL {
  return sql`true`;
}

/**
 * The bot predicate for a table whose rows hang off `content` and inherit its lane: the four per-source
 * tables.
 *
 * ## Why a side table needs its own predicate at all
 *
 * A composite foreign key ties `content_slack.content_id` to `content.id`, and nothing about that key
 * carries the parent's row-level security across. RLS is judged per relation: a bot query that reads
 * `content_slack` directly is answered from `content_slack`'s own policy, and `content_bot_read`'s
 * `visibility = 'public'` is never consulted because `content` is not in the query. With `true` here,
 * every private message's channel, thread, reply and reaction counts were readable by the role the whole
 * scheme exists to deny — MEASURED as `set role slopweaver_bot` over a copy of the live store:
 * `content` answered 974,477 of 1,216,267 rows with 241,790 private hidden, while `content_slack` answered
 * all 707,852, **177,200 of them with a parent the same connection could not see**. With this predicate the
 * second number is 0. Reproduce: `docs/store/owner-registers-and-roles.md` § The roles carries both counts and the flip command.
 *
 * ## What the predicate does
 *
 * Correlates on the parent: a side row is visible exactly when its content row is public. `content_id`
 * is unqualified because a policy's expression is evaluated against the row of the table it governs, and
 * the subquery aliases `content` so the two `id` columns cannot be confused. The subquery runs under the
 * bot's own role, so `content_bot_read` applies inside it as well — that is belt and braces rather than
 * the mechanism, because a predicate that only worked by way of another table's policy would silently
 * open the moment that policy was relaxed.
 *
 * ## What it costs
 *
 * An RLS predicate is a security qualifier: the planner applies it before any user-supplied condition, so
 * it is one primary-key probe into `content` per side row the scan touches — NOT per row the query
 * returns. MEASURED on the same database with the predicate flipped between runs: a side row
 * by primary key 0.07 → 0.24 ms, a `--channel` semi-join count 170 → 458 ms, a per-source facet over the
 * newest 50 114 → 135 ms, and a bare `count(*)` over the whole side table 49.8 ms → **2,469 ms**, which
 * loses the index-only scan. That last shape is what this costs and no verb issues it; `docs/store/owner-registers-and-roles.md`
 * § The roles has the table, the reproduction and why `IN` is 600× worse than `EXISTS` here.
 *
 * @returns a predicate that admits a row when its parent content row is public
 */
export function botSeesPublicParent(): SQL {
  return sql`exists (select 1 from content c where c.id = content_id and c.visibility = 'public')`;
}
