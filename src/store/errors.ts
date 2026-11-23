/**
 * The store's own typed failures — one union for the whole bounded module, per `error-handling.md`.
 *
 * These earn a discriminated union rather than a `readonly string[]` because callers genuinely branch on
 * them. The CLI turns `STORE_URL_MISSING` into an instruction and everything else into a non-zero exit,
 * and ingest counts `ROW_REFUSED` per source while letting the stream continue. A refusal a caller could
 * only ever print would not have needed a `code` at all.
 *
 * `ROW_REFUSED` is the one that shapes the design. The point of the CHECK constraints and the Zod
 * boundary is that a bad row is refused rather than stored, and a refusal that sank the whole ingest
 * would make that guarantee useless on a two-million-record corpus — one malformed line out of a million
 * must not cost the other 999,999. So a refusal is a VALUE the stream carries and reports per source at
 * the end, never a throw.
 */

import { type StoreBronzeAccessError, StoreBronzeAccessErrors } from "./bronzeAccessErrors.js";
import type { PersonCollision } from "./identity/rekey.js";
import { type StoreLifecycleError, StoreLifecycleErrors } from "./lifecycleErrors.js";

/** The store was asked to connect and given no connection string. */
export interface StoreUrlMissingError {
  readonly code: "STORE_URL_MISSING";
  readonly message: string;
  readonly envVar: string;
  /** The credential-store file that remembers the selection, so the message can name both places. */
  readonly secretName: string;
}

/** A connection, a query or a write failed at the database. */
export interface StoreQueryFailedError {
  readonly code: "STORE_QUERY_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** One record could not be projected into a storable row, and says which record and why. */
export interface StoreRowRefusedError {
  readonly code: "ROW_REFUSED";
  readonly message: string;
  readonly source: string;
  readonly sourceId: string;
  readonly reason: string;
}

/**
 * A query named a person the store does not hold, and offers the names it does.
 *
 * Its own variant rather than a `QUERY_FAILED`, because nothing failed: the database answered, and the
 * answer was that nobody by that name is in here. A caller branches on it to print the near misses, and
 * the whole reason it exists is that the alternative — an empty page — is indistinguishable from a person
 * who genuinely said nothing on any platform.
 */
export interface StorePersonUnknownError {
  readonly code: "PERSON_UNKNOWN";
  readonly message: string;
  readonly name: string;
  /** The closest display names the store does hold, empty when none is close. */
  readonly suggestions: readonly string[];
  /** How many people the store holds at all, so "none of these" and "the store is empty" stay apart. */
  readonly known: number;
}

/**
 * An identity reconcile met a `person` unique index it cannot satisfy, and says WHICH person.
 *
 * Its own variant rather than a {@link StoreQueryFailedError}, because the bare driver line —
 * `duplicate key value violates unique constraint "uq_person_google_id"` — names an index and nobody, and the
 * remedy is always about one human: whose directory id or platform id is held by another row. Found either
 * by the rekey plan before any write (no `cause`) or off the database's own refusal (with one).
 */
export interface StorePersonCollidedError {
  readonly code: "PERSON_COLLIDED";
  readonly message: string;
  readonly collisions: readonly PersonCollision[];
  readonly cause?: unknown;
}

/**
 * The store URL reaches a host that is not this machine. A HOLD with no escape hatch: the owner ruled the store
 * always a local database on this machine, a hard rule.
 */
export interface StoreUrlRemoteError {
  readonly code: "STORE_URL_REMOTE";
  readonly message: string;
  readonly host: string;
}

/**
 * A retired on-disk copy of the Storage address or key is still in the home and would not be removed. The
 * store refuses to open over it: the owner's ruling is that the key is stored nowhere, so a copy that cannot
 * go is a failure to say out loud, never a warning to scroll past.
 */
export interface StoreRetiredCopyUnremovedError {
  readonly code: "STORE_RETIRED_COPY_UNREMOVED";
  readonly message: string;
  /** The file that would not go. */
  readonly path: string;
}

/**
 * A caller typed something as `--id` that addresses no record.
 *
 * One variant rather than three, because every caller does the same thing with it — displays it and
 * stops. What differs is only WHICH spelling was wrong, and that is the `spelling` field plus the
 * message, not a code anybody branches on. `src/store/slackIds.ts` is the only producer.
 */
export interface StoreAddressUnreadableError {
  readonly code: "ADDRESS_UNREADABLE";
  readonly message: string;
  /** Exactly what the caller typed, trimmed — so a report can echo it without re-reading the argv. */
  readonly spelling: string;
}

/** The database does not match the journal, and the stale-store hatch is closed. */
export interface StoreStaleError {
  readonly code: "STORE_STALE";
  readonly message: string;
  readonly state: string;
}

/** An around read asked for a walk the disclosure ladder does not have. */
export interface StoreUnknownModeError {
  readonly code: "UNKNOWN_MODE";
  readonly message: string;
  readonly asked: string;
  readonly known: readonly string[];
}

/** A query named a facet, source or kind the schema has no word for. */
export interface StoreUnknownFacetError {
  readonly code: "UNKNOWN_FACET";
  readonly message: string;
  readonly facet: string;
  readonly known: readonly string[];
}

/**
 * Nothing answered at the database's address — the local Supabase stack is not running.
 *
 * Its own variant rather than a {@link StoreQueryFailedError}, because a caller genuinely branches on it
 * and the two failures mean opposite things: a query that failed proves the database is THERE and said no,
 * while this one proves nothing was listening at all. Lumping them produced
 * `read the migration state failed: connect ECONNREFUSED 127.0.0.1:55322`, which names a port and no
 * remedy.
 *
 * **Owner ruling**: with the stack down once the board itself lives in the store, the fleet
 * fails loudly, because that degrades everything and the owner needs to know at once. So this is deliberately NOT a policy refusal with
 * an escape hatch — there is nothing to override, the database is absent — and it is deliberately not a
 * fallback to a local copy either. A fleet quietly running on a stale local board is the degradation the owner
 * names. It fails, it says why, and it says how to bring the stack back.
 */
export interface StoreUnreachableError {
  readonly code: "STORE_UNREACHABLE";
  readonly message: string;
  /** What the driver actually reported, kept so a non-refused failure (DNS, timeout) stays distinguishable. */
  readonly reason: string;
}

/**
 * Every way the store can fail; the lifecycle's own members are declared in `./lifecycleErrors.ts` and
 * reading bronze off disk in `./bronzeAccessErrors.ts`.
 */
export type StoreError =
  | StoreLifecycleError
  | StoreBronzeAccessError
  | StoreAddressUnreadableError
  | StorePersonCollidedError
  | StorePersonUnknownError
  | StoreQueryFailedError
  | StoreRowRefusedError
  | StoreStaleError
  | StoreUnknownFacetError
  | StoreUnknownModeError
  | StoreUnreachableError
  | StoreUrlMissingError
  | StoreUrlRemoteError
  | StoreRetiredCopyUnremovedError;

/**
 * The text a caught error actually carries, including the one shape that carries none of its own.
 *
 * @param deepest the innermost cause, already walked
 * @returns a non-empty reason, falling back to the error's own name rather than to an empty string
 */
function reasonTextOf({ deepest }: { deepest: unknown }): string {
  if (!(deepest instanceof Error)) {
    return String(deepest);
  }
  if (deepest.message.length > 0) {
    return deepest.message;
  }
  // MEASURED against an unreachable port: `postgres.js` reports a failed CONNECTION as an
  // `AggregateError` whose own `message` is the empty string, with one entry per address family in
  // `errors` (`connect ECONNREFUSED ::1:55999`, `connect ECONNREFUSED 127.0.0.1:55999`). Reproduce with
  // `SLOPWEAVER_STORE_URL=postgresql://postgres:x@localhost:55999/postgres slopweaver store status`.
  // Without this arm every store verb printed `… failed: ` and named nothing at all, which is the one
  // failure a caller most needs told: the database is not there.
  if ("errors" in deepest && Array.isArray(deepest.errors)) {
    const first = deepest.errors.find((entry: unknown) => entry instanceof Error && entry.message.length > 0);
    if (first instanceof Error) {
      return first.message;
    }
  }
  return deepest.name;
}

/**
 * The one line of a database error that belongs in a message, with the statement and its values removed.
 *
 * MEASURED, and this exists because of what it printed. A GitHub ingest of 1,200 records hit
 * a real constraint failure and `postgres.js` builds its `Error.message` from the whole failed statement
 * plus every bound parameter — so the refusal wrote **962,926 bytes** to the terminal, most of it the
 * verbatim bodies of a hundred pull requests. Reproduce the shape on any failing batch insert; the
 * message begins `Failed query: insert into "content" …` and runs to a `params:` line carrying the rows.
 *
 * That is worse than noise. The store's whole purpose is to hold the corpus behind a boundary, and an
 * error path that spills its contents to stdout is a boundary with a hole in it. Postgres's own reason
 * is everything a reader needs; the statement is reconstructible from the code and the parameters ARE
 * the corpus.
 *
 * @param cause whatever the driver threw
 * @returns the first line of the reason, capped, with no statement and no bound values
 */
function databaseReason({ cause }: { cause: unknown }): string {
  let deepest: unknown = cause;
  // Drizzle wraps the driver's error and puts the whole statement in its own `message`; the driver's
  // error, carrying Postgres's actual reason, is the `cause` underneath. Walking to the bottom is what
  // turns a megabyte of statement into `duplicate key value violates unique constraint …`.
  while (deepest instanceof Error && deepest.cause !== undefined && deepest.cause !== null) {
    deepest = deepest.cause;
  }
  const raw = reasonTextOf({ deepest });
  // `!` rather than a fallback: `split` with a limit of one always yields at least one element, even for
  // the empty string, so an absent element here would be a fault in the runtime rather than in the data.
  const line = raw.split("\n", 1)[0]!;
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

/**
 * Whether a driver's reason means nothing was listening, rather than that the database answered no.
 *
 * Pure, and exported so the classification is testable without a database. The three codes are the ways a
 * local stack that is not running presents: `ECONNREFUSED` when the port is closed, `ENOTFOUND` when the
 * host does not resolve, and `ETIMEDOUT` when the container is up but not accepting yet. Matched on the
 * code rather than on prose, because the surrounding text is the driver's and changes between versions.
 *
 * MEASURED against a closed port: `SLOPWEAVER_STORE_URL=postgresql://127.0.0.1:59999/nope
 * slopweaver store verify` reports `connect ECONNREFUSED 127.0.0.1:59999` and exits 1.
 *
 * @param reason the driver's reason, as {@link databaseReason} already reduced it
 * @returns whether the address answered nothing at all
 */
export function isUnreachableReason({ reason }: { reason: string }): boolean {
  return ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].some((code) => reason.includes(code));
}

/**
 * The one wording of "the stack is not running", so the lifecycle read and {@link StoreErrors.unreachable}
 * cannot drift into two different answers to the same question.
 *
 * It lives here rather than in `lifecycle.ts` because `readMigrationState` and {@link connectStore} both
 * have to say this, each through {@link StoreErrors.unreachable}. A second wording is how a
 * verb comes to tell an operator something the next verb contradicts — the message names
 * `slopweaver store verify`, which is itself one of the two callers.
 *
 * @param reason the driver's reason, already reduced to one line
 * @returns the whole loud message
 */
export function unreachableMessage({ reason }: { reason: string }): string {
  return (
    `the store is not there: ${reason}. Nothing answered at that address, so the local Supabase stack is ` +
    `not running — and nothing here falls back to a local copy, because a fleet running on a stale board ` +
    `is worse than one that stops (owner ruling: fail loudly, because a stopped store degrades ` +
    `everything). Start it with \`yarn store:start\` from the slopweaver checkout. ` +
    `If it IS running, \`yarn store:status\` prints the port the stack actually bound — the 553xx block that ` +
    `\`supabase/config.toml\` declares, never the CLI's 543xx defaults.`
  );
}

/**
 * One person collision as a clause: who carries the value, which index holds it, and why when the plan knows.
 *
 * @param collision the collision to describe
 * @returns the clause, naming the drafts' emails
 */
function collisionText({ collision }: { collision: PersonCollision }): string {
  const named = `${collision.column} ${collision.value}, carried by ${collision.emails.join(", ")}, is already held by another person row (${collision.constraint})`;
  return collision.why === undefined ? named : `${named}: ${collision.why}`;
}

/** What a refused Slack permalink carries: what was typed, and the two digit counts that disagreed. */
interface AddressLinkArgs {
  readonly spelling: string;
  readonly digits: number;
  readonly wanted: number;
}

/** The factories every store failure is built through, so a test constructs one exactly as the code does. */
export const StoreErrors = {
  ...StoreLifecycleErrors,
  ...StoreBronzeAccessErrors,
  addressEmpty: (): StoreAddressUnreadableError => ({
    code: "ADDRESS_UNREADABLE",
    message: "--id is required — give a record uuid, a <channel>:<ts> id, or a Slack message link",
    spelling: "",
  }),
  addressNotAMessageLink: ({ spelling, digits, wanted }: AddressLinkArgs): StoreAddressUnreadableError => ({
    code: "ADDRESS_UNREADABLE",
    message:
      `that Slack link's p-number carries ${String(digits)} digits, and a message permalink carries ` +
      `${String(wanted)} — it addresses a file, a canvas or a channel rather than a message`,
    spelling,
  }),
  addressUnreadable: ({ spelling }: { spelling: string }): StoreAddressUnreadableError => ({
    code: "ADDRESS_UNREADABLE",
    message:
      `"${spelling}" is not a record uuid, a Slack <channel>:<ts> id or a Slack message link — ` +
      "a channel id looks like C0SYN4E1234567 and a timestamp like 1789717308.365179",
    spelling,
  }),
  unreachable: ({ reason }: { reason: string }): StoreUnreachableError => ({
    code: "STORE_UNREACHABLE",
    message: unreachableMessage({ reason }),
    reason,
  }),
  queryFailed: ({ cause, what }: { cause: unknown; what: string }): StoreQueryFailedError => ({
    cause,
    code: "STORE_QUERY_FAILED",
    message: `${what} failed: ${databaseReason({ cause })}`,
  }),
  rowRefused: ({
    source,
    sourceId,
    reason,
  }: {
    source: string;
    sourceId: string;
    reason: string;
  }): StoreRowRefusedError => ({
    code: "ROW_REFUSED",
    message: `${source} record ${sourceId} is not storable: ${reason}`,
    reason,
    source,
    sourceId,
  }),
  personCollided: ({
    cause,
    collisions,
    what,
  }: {
    cause?: unknown;
    collisions: readonly PersonCollision[];
    what: string;
  }): StorePersonCollidedError => ({
    ...(cause === undefined ? {} : { cause }),
    code: "PERSON_COLLIDED",
    collisions,
    message: `${what} failed, writing nothing: ${collisions.map((collision) => collisionText({ collision })).join("; ")}`,
  }),
  personUnknown: ({
    name,
    suggestions,
    known,
  }: {
    name: string;
    suggestions: readonly string[];
    known: number;
  }): StorePersonUnknownError => ({
    code: "PERSON_UNKNOWN",
    known,
    message:
      suggestions.length > 0
        ? `no person named "${name}" — the store holds ${suggestions.join(", ")}`
        : `no person named "${name}", and none of the ${String(known)} people the store holds is close to it`,
    name,
    suggestions,
  }),
  unknownMode: ({ asked, known }: { asked: string; known: readonly string[] }): StoreUnknownModeError => ({
    asked,
    code: "UNKNOWN_MODE",
    known,
    message: `no mode named "${asked}" — --mode takes ${known.join(", ")}`,
  }),
  unknownFacet: ({ facet, known }: { facet: string; known: readonly string[] }): StoreUnknownFacetError => ({
    code: "UNKNOWN_FACET",
    facet,
    known,
    message: `no facet named "${facet}" — the store groups by ${known.join(", ")}`,
  }),
  stale: ({ refusal, state }: { refusal: string; state: string }): StoreStaleError => ({
    code: "STORE_STALE",
    message: refusal,
    state,
  }),
  retiredCopyUnremoved: ({ path }: { path: string }): StoreRetiredCopyUnremovedError => ({
    code: "STORE_RETIRED_COPY_UNREMOVED",
    message:
      `refusing to open the store: ${path} is a retired copy of the Storage address or key, which is read off ` +
      `the running stack and stored nowhere, and it would not be removed. Remove it by hand, then re-run.`,
    path,
  }),
  urlRemote: ({ host }: { host: string }): StoreUrlRemoteError => ({
    code: "STORE_URL_REMOTE",
    host,
    message:
      `refusing to reach the store: its URL names host ${host}, which is not this machine (only 127.0.0.1, ::1 ` +
      `and localhost are). The owner's ruling: the store is always a local database on this machine, a hard rule. ` +
      `This hold has no escape hatch: no environment variable, flag or grant opens it. Select a store on this ` +
      `machine with \`slopweaver secrets set store-url\`.`,
  }),
  urlMissing: ({ envVar, secretName }: { envVar: string; secretName: string }): StoreUrlMissingError => ({
    code: "STORE_URL_MISSING",
    envVar,
    message:
      `refusing to reach the store: no database is selected. A tool that picks its own database is a tool ` +
      `that can run against the wrong one, so nothing here defaults one. Select it once with ` +
      `\`slopweaver secrets set ${secretName}\` (remembered under $SLOPWEAVER_HOME/secrets at 0600, which ` +
      `is what every later process — a bot turn included — reads), or export ${envVar} for one run.`,
    secretName,
  }),
} as const;

/**
 * The lines a {@link StoreError} prints, one per problem. A list-carrying variant gives each entry its own line,
 * as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function storeErrorLines({ error }: { error: StoreError }): readonly string[] {
  if (
    error.code === "GENERATE_EXITED" ||
    error.code === "MIGRATION_FAILED" ||
    error.code === "STATE_REFUSED" ||
    error.code === "LIFECYCLE_REFUSED" ||
    error.code === "REBUILD_FAILED"
  ) {
    return error.reasons;
  }
  if (error.code === "PERSON_COLLIDED" && error.collisions.length > 1) {
    return [
      `${String(error.collisions.length)} people collided, so nothing was written:`,
      ...error.collisions.map((collision) => `  ${collisionText({ collision })}`),
    ];
  }
  return [error.message];
}

/**
 * The driver's own reason out of a composed unreachable message, so the typed error's `reason` field means
 * the same thing whichever path built it.
 *
 * {@link unreachableMessage} opens with `the store is not there: <reason>. Nothing answered …`, so the
 * reason is what sits between that prefix and the sentence that follows it. A message that does not carry
 * the prefix is returned whole rather than guessed at — this recovers a known shape, it does not parse.
 *
 * @param message the composed message, or any reason that classified as unreachable
 * @returns the driver's reason
 */
export function driverReasonWithin({ message }: { message: string }): string {
  const prefix = "the store is not there: ";
  if (!message.startsWith(prefix)) {
    return message;
  }
  const rest = message.slice(prefix.length);
  const end = rest.indexOf(". Nothing answered");
  return end === -1 ? rest : rest.slice(0, end);
}
