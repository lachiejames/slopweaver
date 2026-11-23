/**
 * The organisation this install works for — written once, and reached only through `../../organisation/store.ts`.
 *
 * The organization is written once and used everywhere, and there is no home
 * directory to hold it. So it is a row in the store rather than a constant in code or a file
 * under `$SLOPWEAVER_HOME`, and a fresh install that has not written it is refused by name
 * (`../../organisation/errors.ts`'s `ORG_NOT_CONFIGURED`) instead of placing nothing as the team's and calling that
 * an answer.
 *
 * A SINGLETON, enforced by the database exactly as `owner_profile` is: one install works for one organisation, and a
 * table accepting a second row would hand every reader a choice it has no way to make.
 *
 * This build's own repository is deliberately NOT a column: it is read off the checkout's `origin`
 * (`../../organisation/read.ts`), so it follows the repository wherever it moves and is never configured.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** The only primary-key value `organisation` accepts, spelled once so a reader and the CHECK agree. */
export const ORGANISATION_ID = "organisation";

/**
 * The organisation row. The three nullable columns are STATEMENTS — the organisation has no Google Workspace, no
 * Linear, no Vanta — written by `org set --without-…`; nothing is left null by omission, because `org set` writes the
 * whole row every time.
 */
export const organisationTable = pgTable(
  "organisation",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    githubOwner: text("github_owner").notNull(),
    googleDomain: text("google_domain"),
    slackHosts: text("slack_hosts").array().notNull(),
    linearWorkspace: text("linear_workspace"),
    vantaWorkspace: text("vanta_workspace"),
    repositories: text("repositories").array().notNull(),
    dependencyBots: text("dependency_bots").array().notNull(),
    /** Bumped on every write, and what an optimistic write pins to — `owner_profile`'s reason, verbatim. */
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("organisation_is_singleton", sql.raw(`id = '${ORGANISATION_ID}'`)),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "organisation" }),
  ],
);

/** The organisation row as the database returns it. */
export type OrganisationRow = typeof organisationTable.$inferSelect;

/** The organisation row as an insert takes it. */
export type NewOrganisationRow = typeof organisationTable.$inferInsert;
