/**
 * The one table dedicated to the owner — global, rather than split per Claude project.
 *
 * What a session knows about the owner is global: the Slopweaver plugin is loaded globally, so it is present
 * in every project, while Claude's own project memories split what one project knows from another. With our
 * own storage, one table dedicated to the owner replaces that split.
 *
 * ## Why a singleton, and why the database enforces it
 *
 * There is one owner of one local store. A table that ACCEPTS a second row invites a second row — a
 * per-project one, which is the exact split the ruling removes — and every reader would then have to pick
 * one, which is a decision no reader has the information to make. So the primary key is the literal
 * `owner` and a CHECK refuses anything else, the same way each per-source table pins its own `source`.
 * A reader can then write `where id = 'owner'` and be right by construction rather than by convention.
 *
 * ## What stays in `profile.json`, and why this is not a migration of it
 *
 * `$SLOPWEAVER_HOME/profile.json` is per-INSTALL configuration: which sources are on, which checkouts are
 * main, the bot's card chrome, the reaction emoji, the owner's Slack id. All of that describes a machine
 * and none of it describes a person, so none of it moves. What lands here is what a session needs to know
 * about the owner before it writes anything — which is precisely the material that was scattered across
 * per-project auto-memory and therefore invisible from `acme-admin`.
 */
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { JudgementProfile } from "../../live/turn/judgementProfile.js";
import type { OwnerSelfDescription } from "../profile/types.js";

import { personTable } from "./person.js";
import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** The only primary-key value `owner_profile` accepts, spelled once so a reader and the CHECK agree. */
export const OWNER_PROFILE_ID = "owner";

/**
 * Everything the world model knows about its owner, in one row reachable from any project.
 *
 * `personId` is nullable rather than required: identity reconciliation places the owner from the member pull
 * like anyone else, and a fresh install has a self-description before it has run a member pull at all.
 * When it is set, the owner's own history is one join away.
 *
 * `judgementProfile` carries the mined voice-and-routing profile that `live/turn/judgementProfile.ts`
 * already schemas. It lands here rather than staying at `$SLOPWEAVER_HOME/judgement/profile.json` for the
 * ruling's own reason — a file under one install's home is not global — and it is nullable because an
 * install that has never run a mining pass genuinely has none, which is a different claim from an empty one.
 */
export const ownerProfileTable = pgTable(
  "owner_profile",
  {
    id: text("id").primaryKey(),
    personId: uuid("person_id").references(() => personTable.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    selfDescription: jsonb("self_description").$type<OwnerSelfDescription>().notNull(),
    judgementProfile: jsonb("judgement_profile").$type<JudgementProfile>(),
    /**
     * Bumped on every write, and what an optimistic write pins to.
     *
     * An integer rather than the `updatedAt` timestamp, because two writes inside one clock tick are
     * indistinguishable by time and a counter settles them. `updatedAt` stays beside it for the different
     * question a reader asks — how old is this — which a counter cannot answer.
     */
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("owner_profile_is_singleton", sql.raw(`id = '${OWNER_PROFILE_ID}'`)),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "owner_profile" }),
  ],
);

/** The owner row as the database returns it. */
export type OwnerProfileRow = typeof ownerProfileTable.$inferSelect;

/** The owner row as an insert takes it. */
export type NewOwnerProfileRow = typeof ownerProfileTable.$inferInsert;
