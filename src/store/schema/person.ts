/**
 * One row per HUMAN, keyed by their email address, with the id every platform knows them by as a column.
 *
 * ## The rule this is the shape of
 *
 * Identities are pulled from Google Admin and the email address is the key. Slack user id, Linear user id,
 * GitHub user id and handle are columns. Each person is an actual person as provisioned in Google Admin,
 * which means far fewer bots on the persons table.
 *
 * So there is no identity array and no identity table. `email` is the natural key — UNIQUE, NOT NULL,
 * normalised — and each platform's id is one nullable UNIQUE column. `id` stays as the surrogate the
 * foreign key from `content.author_id` points at, because re-keying a million content rows onto a text
 * column buys nothing the unique email does not already give.
 *
 * ## What is structurally impossible here that was merely unlikely before
 *
 * MEASURED on the live store under the earlier identity-array shape: a couple of thousand people of whom nearly half were
 * named by a Slack id and a fifth by a UUID, dozens of display names shared by two or more rows, and several Slack `B…` bot ids stored under
 * `"source": "linear"`. Every one of those was a row the old schema ACCEPTED. Here:
 *
 * - **A person is one email**, so the same human cannot be two rows — `uq_person_email`.
 * - **A platform id belongs to one person** — one UNIQUE index per id column, no trigger over an array.
 * - **An id cannot sit in the wrong column** — each column carries a CHECK pinning it to that platform's
 *   own id shape, so a Slack member id in `linear_user_id`, or a display name in it, is a refusal.
 * - **A bot cannot be a person** — a bot has no mailbox and no Google Admin row, and `email` is required.
 *   What a bot authored keeps the platform's own author id on the content row
 *   ({@link ../schema/content.contentTable}'s `authorNativeId`) rather than a person it is not.
 *
 * ## Who writes it
 *
 * ONE writer: `slopweaver store identity` ({@link ../identity/reconcile}), from the Google Admin directory
 * and the member pull. Record ingest only LOOKS UP these columns — it never mints a person from an author
 * it met on a message, which is the fallback (`displayName: author.handle ?? author.nativeId`) that named
 * 1,241 people by their id.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { PersonJudgement } from "../profile/types.js";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/**
 * The regular expression each platform id column is pinned to, spelled once so the CHECK, the reconciler's
 * own refusal and the tests all read the same shape.
 *
 * Slack member ids start with `U` (or `W` on an Enterprise Grid) and are upper-case alphanumerics; a `B…`
 * bot id fails on purpose. Linear and Notion issue UUIDs. GitHub's account id is its immutable integer;
 * the login is what a person can rename, kept beside it so a row is readable. Google's user id is an
 * integer too.
 */
export const PERSON_ID_SHAPES = {
  email: "^[^@[:space:]]+@[^@[:space:]]+$",
  githubId: "^[0-9]+$",
  githubLogin: "^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$",
  googleId: "^[0-9]+$",
  linearDisplayName: "^[^\\s@]+$",
  linearUserId: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  notionUserId: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  slackUserId: "^[UW][A-Z0-9]{8,}$",
} as const;

/**
 * Every person the world model knows: one human, one email, and the id each platform calls them by.
 *
 * `displayName` is required because a person with no name is not addressable in any output. `active` is
 * three-valued on purpose (a departure is a FIELD, never a deletion):
 * Google's own `suspended`/`archived` word when Google Admin holds the person, the platforms' word when it
 * does not, and `null` when nobody said — which is a different claim from `true`.
 */
export const personTable = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The key: the normalised primary address. Lower-cased and trimmed, never a display form. */
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    givenName: text("given_name"),
    familyName: text("family_name"),
    /** Google Workspace's immutable user id; `null` for a person Google Admin does not hold. */
    googleId: text("google_id"),
    active: boolean("active"),
    orgUnitPath: text("org_unit_path"),
    title: text("title"),
    slackUserId: text("slack_user_id"),
    linearUserId: text("linear_user_id"),
    /**
     * Linear's own @-handle for the person, beside their id, because tens of thousands of Linear rows in this store name
     * their author by it: captures older than the connector's id fix carry `creator: { displayName }` and
     * nothing else, and bronze cannot be re-derived without a re-fetch. Set only from an ORG member — an
     * external user an integration minted can echo a member's handle.
     */
    linearDisplayName: text("linear_display_name"),
    githubId: text("github_id"),
    githubLogin: text("github_login"),
    notionUserId: text("notion_user_id"),
    /**
     * What is known about this person, and how to write to them.
     *
     * NULLABLE, and the null is load-bearing: it means nobody has curated this person, which is a
     * different claim from a person with no preferences. Of the 2,211 people the member pull places, roughly
     * ten are briefed, so the overwhelmingly common value here is null and a reader must not read that
     * as "measured to have nothing".
     *
     * A COLUMN rather than a table, holding some kind of facts about that person or per-person
     * judgement, and because a second table keyed on `person.id` buys a foreign key nothing needed and
     * costs every reader a join. `../profile/types.ts` carries the
     * shape and why each bucket is named rather than free-form.
     *
     * **Only curation writes it.** `../identity/reconcile.ts` sets the platform id columns and `updatedAt` and
     * names no other column, so a member pull cannot clobber judgement it did not author. That is a
     * property of the reconciler's own UPDATE list rather than of this column, which is why it is asserted
     * by a test rather than trusted.
     */
    judgement: jsonb("judgement").$type<PersonJudgement>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_person_email").on(table.email),
    uniqueIndex("uq_person_google_id").on(table.googleId),
    uniqueIndex("uq_person_slack_user_id").on(table.slackUserId),
    uniqueIndex("uq_person_linear_user_id").on(table.linearUserId),
    uniqueIndex("uq_person_linear_display_name").on(table.linearDisplayName),
    uniqueIndex("uq_person_github_id").on(table.githubId),
    uniqueIndex("uq_person_github_login").on(table.githubLogin),
    uniqueIndex("uq_person_notion_user_id").on(table.notionUserId),
    index("idx_person_display_name").on(table.displayName),
    check("person_email_shape", sql.raw(`email ~ '${PERSON_ID_SHAPES.email}' and email = lower(btrim(email))`)),
    check("person_google_id_shape", sql.raw(`google_id is null or google_id ~ '${PERSON_ID_SHAPES.googleId}'`)),
    check(
      "person_slack_user_id_shape",
      sql.raw(`slack_user_id is null or slack_user_id ~ '${PERSON_ID_SHAPES.slackUserId}'`),
    ),
    check(
      "person_linear_user_id_shape",
      sql.raw(`linear_user_id is null or linear_user_id ~ '${PERSON_ID_SHAPES.linearUserId}'`),
    ),
    check(
      "person_linear_display_name_shape",
      sql.raw(`linear_display_name is null or linear_display_name ~ '${PERSON_ID_SHAPES.linearDisplayName}'`),
    ),
    check("person_github_id_shape", sql.raw(`github_id is null or github_id ~ '${PERSON_ID_SHAPES.githubId}'`)),
    check(
      "person_github_login_shape",
      sql.raw(`github_login is null or github_login ~ '${PERSON_ID_SHAPES.githubLogin}'`),
    ),
    check(
      "person_notion_user_id_shape",
      sql.raw(`notion_user_id is null or notion_user_id ~ '${PERSON_ID_SHAPES.notionUserId}'`),
    ),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "person" }),
  ],
);

/** A person as the database returns them. */
export type PersonRow = typeof personTable.$inferSelect;

/** A person as an insert takes them. */
export type NewPersonRow = typeof personTable.$inferInsert;

/**
 * The person column that carries a platform's author id, per content source that has one.
 *
 * `gmail`, `self`, `calendar` and `fathom` are absent on purpose: a mail record's author is a display
 * name with its address redacted by record bronze, and the other three name no platform account. An
 * author on those rows stays on `content.author_native_id` and resolves to nobody. Written once here so
 * the reconciler's re-pointing and ingest's lookup cannot disagree about which column a source reads.
 */
export const PERSON_COLUMN_BY_SOURCE = {
  github: "githubLogin",
  linear: "linearUserId",
  notion: "notionUserId",
  slack: "slackUserId",
} as const;

/** A content source whose author id resolves through a `person` column. */
export type PersonResolvableSource = keyof typeof PERSON_COLUMN_BY_SOURCE;

/** Every resolvable source, for a loop that must not cast `Object.keys`. */
export const PERSON_RESOLVABLE_SOURCES: readonly PersonResolvableSource[] = ["github", "linear", "notion", "slack"];

/**
 * Whether a content source's author id resolves to a person column at all.
 *
 * @param source the content source
 * @returns whether {@link PERSON_COLUMN_BY_SOURCE} names a column for it
 */
export function isPersonResolvableSource(source: string): source is PersonResolvableSource {
  return Object.hasOwn(PERSON_COLUMN_BY_SOURCE, source);
}
