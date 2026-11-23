/**
 * Every closed vocabulary the store enforces, as Postgres enums.
 *
 * These are declared once and imported by the tables, rather than spelled as `text` columns with a
 * convention, because a vocabulary the database does not know is a vocabulary that only holds while
 * everyone remembers it. MEASURED on the board this store replaces: two rows carried a
 * `status:` outside the type — one of them, `paused`, was invalid on Saturday and correct by Sunday
 * because a DIFFERENT row landed the word into the union, with nothing about the invalid file changing.
 * The validity of a value is not a property of the row that carries it, which is exactly why it has to
 * live where a write is checked rather than where a reader remembers. Reproduce the survivor with
 * `grep -l "^status: *blocked" ~/.slopweaver/handovers/*.md`.
 *
 * One content table with a `source` discriminator, and the
 * per-source shapes enforced so that "a field irrelevant to a source" cannot be stored — the owner's archive
 * achieved the type half of that and never had the database half, so both are here.
 */
import { pgEnum } from "drizzle-orm/pg-core";

import { CORPUS_KINDS } from "../../corpus/types.js";
import { BRONZE_SOURCES } from "../../integrations/corpusSources.js";
import { DATA_CLASSES } from "../dataClass.js";

/**
 * Where a content row came from.
 *
 * **Built from `BRONZE_SOURCES` itself** (`src/integrations/corpusSources.ts`), so it is the SAME membership by
 * construction: a source that can appear on a line of bronze must be storable, and one that cannot must not be.
 * `gold` is absent because it is synthesised at query time and never persisted. The ORDER is the enum's too, and
 * each source's append-only `ordinal` is what holds it, because a reordered Postgres enum value is a migration;
 * `unit/store/schemaDrift.test.ts` pins `enumValues` exactly, and the generated DDL still spells every value.
 */
export const contentSourceEnum = pgEnum("content_source", BRONZE_SOURCES);

/**
 * The unit a content row represents, kept source-neutral so a query never branches per source.
 *
 * **Built from `CORPUS_KINDS` itself**, not restated beside it. A kind a connector can put on a line of
 * bronze must be storable, or ingest refuses a row the corpus already holds — and a list that has to
 * AGREE with another list is a list that eventually will not. Derived, the disagreement is
 * unrepresentable, which is the same move `contentRequiredMetadataKeys` makes for the per-source checks.
 * The generated DDL still spells every value, so the migration a reader reviews is unchanged.
 *
 * MEASURED, which is why it is derived rather than checked: the first version of this enum was
 * written from the shape of the sources and was wrong in both directions at once. It had no word for
 * `need`, `huddle` or `transcript`, so every Slack huddle and every Google Meet transcript in bronze was
 * unstorable, and it carried an `email` no connector has ever emitted. Reproduce the second half with
 * `grep -rhon 'kind: "[a-z]*"' src/corpus/gmail/` — the mailbox writes `message` and `transcript`.
 */
export const contentKindEnum = pgEnum("content_kind", CORPUS_KINDS);

/**
 * A row's read scope, and the axis every row-level security policy turns on.
 *
 * `public` is org-shared surface; `private` is the owner-only lane — private channels, direct messages,
 * the mailbox and the diary. The `bot` role is denied `private` at the policy level rather than by a
 * filter someone has to remember to apply, which is the whole reason this is an enum and not a boolean:
 * a third scope can be added without every policy having to be rewritten around a negation.
 */
export const visibilityEnum = pgEnum("visibility", ["public", "private"]);

/**
 * A record's data class: how far beyond the owner it may be surfaced, a second axis beside `visibility` that only
 * ever narrows it.
 *
 * **Built from `DATA_CLASSES` itself** (`../dataClass.ts`), which carries each class's meaning, the unit of
 * classification (one record) and the fail-closed read rule. Every column of this type is NULLABLE with no default:
 * a row written before classification existed holds no class, reads as `unknown` through `effectiveDataClass`, and
 * is never backfilled by the migration that adds the column, so the migration stays additive and the door can apply
 * it.
 */
export const dataClassEnum = pgEnum("data_class", DATA_CLASSES);

/** What a container is, so a channel and a repository are distinguishable without parsing an id. */
export const containerKindEnum = pgEnum("container_kind", [
  "channel",
  "repository",
  "project",
  "team",
  "database",
  "workspace",
  "mailbox",
  "calendar",
  "directory",
  // Where recorded calls live. Its own word rather than `calendar` or `workspace`: a diary holds
  // commitments and a recorder holds what was actually said at one, and a query that could not tell them
  // apart would answer "what is on Thursday" with a transcript.
  "recorder",
  // Where an assistant-chat history lives — the owner's conversations with ChatGPT, and the chat-history
  // providers after it. Its own word because a chat holds two parties, one of them a model, and a query asking
  // what a PERSON said must be able to leave it out.
  "chat",
]);

/**
 * The roles row-level security is written against.
 *
 * Owner, bot and a read-only agent. Segmentation only means something if some
 * role is denied something, and the one that earns its keep here is `bot` — a Slack-facing turn runs as
 * that role and is unable to read a private-lane row, rather than being trusted not to.
 */
export const STORE_ROLES = ["slopweaver_owner", "slopweaver_bot", "slopweaver_agent"] as const;
