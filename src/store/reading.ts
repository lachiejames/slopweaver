/**
 * Look at the store, briefly, so a routing brief can say what its history leg can actually reach.
 *
 * The pure half — what an observation MEANS for the capability row — is {@link ../route/storeReading}. This
 * is the effect: one connection, two statements, a hard budget, and a verdict either way.
 *
 * ## Why the budget is a `statement_timeout` rather than a race
 *
 * A `Promise.race` returns early and leaves the query running, holding a connection the brief then closes
 * underneath it. `statement_timeout` is Postgres cancelling its own work, so the budget is enforced where
 * the work is. `connect_timeout` covers the other half — a selected database that is not listening, which
 * is what a stopped Docker looks like — because a connection attempt that waits for the OS default would
 * make every bot turn hang on a machine where the stack simply is not up.
 *
 * ## Reachability and the census are separate answers, deliberately
 *
 * `select 1` proves the database is there; the grouped count says how much it holds. At corpus scale the
 * second can be slow enough to miss the budget while the first is instant, and those are different facts:
 * a store that is readable with an unfinished census is usable history of unknown extent. Reporting zero
 * rows there would be indistinguishable from an empty store, and only one of the two is true.
 *
 * ## It never starts anything, and never writes
 *
 * No Docker start, no migration, no provider pull, no repair of a database it found in a state it did not
 * expect. A brief that could start a stack would make answering a Slack tag a reason to boot containers.
 */
import { count, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { StoreRouteReading } from "../route/storeReading.js";

import { type StoreUrlOrigin, storeUrlSelection } from "./config.js";
import { contentTable } from "./schema/content.js";

/**
 * How long the whole observation may take, in milliseconds.
 *
 * A DESIGN TARGET rather than a measurement: it is the budget the brief path is willing to spend, chosen
 * so a stopped stack costs a bot turn well under a second and a loaded store's census gets a fair chance.
 * Reproduce the real cost on any install with
 * `time env SLOPWEAVER_STORE_URL=<url> slopweaver turn brief --contracts --text x`, and see
 * `docs/store/history-load-and-full-text.md` § "The history leg a bot turn actually reaches" for what it measured here.
 *
 * @internal
 */
export const STORE_OBSERVATION_BUDGET_MS = 2000;

/**
 * Observe the store a history leg would read, within a hard budget.
 *
 * @param home the Slopweaver home the remembered database selection is read under
 * @param budgetMs how long the whole observation may take before it reports unreachable
 * @returns what was observed — never a throw, because a brief that failed to render because the store was
 *   down would take the whole turn with it
 */
export async function observeStore({
  home,
  budgetMs = STORE_OBSERVATION_BUDGET_MS,
}: {
  home?: string;
  budgetMs?: number;
} = {}): Promise<StoreRouteReading> {
  const selected = storeUrlSelection(home === undefined ? {} : { home });
  if (selected.isErr()) {
    return { because: selected.error.message, kind: "unselected" };
  }
  const seconds = Math.max(1, Math.ceil(budgetMs / 1000));
  // Constructed INSIDE the guard: `postgres()` parses the URL
  // synchronously and throws `TypeError: Invalid URL` on a malformed remembered selection, which built
  // outside the `try` took the whole brief down instead of filing the row as UNAVAILABLE with the reason.
  let sql: postgres.Sql | undefined;
  try {
    sql = postgres(selected.value.url, {
      // Postgres cancels its own statement at the budget, so an over-running census is a refusal with the
      // connection still in a state the caller can close rather than a promise nobody is waiting on. It is a
      // CONNECTION PARAMETER rather than a driver option: `postgres.js` sends it as a `startup` setting, and
      // spelling it at the top level type-errors rather than silently doing nothing.
      connection: { statement_timeout: budgetMs },
      connect_timeout: seconds,
      max: 1,
      onnotice: () => {},
      prepare: false,
    });
    return await observed({ origin: selected.value.origin, sql });
  } catch (error: unknown) {
    return {
      because: `the selected store could not be reached within ${String(budgetMs)} ms — ${firstLine({ error })}`,
      kind: "unreachable",
    };
  } finally {
    if (sql !== undefined) {
      await sql.end({ timeout: seconds });
    }
  }
}

/** What a census attempt produced: the per-source figures, or the fact that Postgres cancelled it. */
type Census =
  | { readonly kind: "counted"; readonly rows: number; readonly bySource: readonly SourceCensus[] }
  | { readonly kind: "cancelled" };

/** One source's row count and the instant of its newest record. */
interface SourceCensus {
  readonly source: string;
  readonly rows: number;
  readonly newest: string | null;
}

/**
 * Count the rows per source and date each source's newest record, in one statement.
 *
 * `max(occurred_at)` rides the census rather than costing a second statement, and it is what lets a turn
 * judge STALENESS instead of only size. Measured: the Slack refresh leg had been frozen for more than a day
 * with the newest bronze file written well after it, while the store's row count looked
 * perfectly healthy — so a row count alone cannot tell a reader that its upstream stopped.
 *
 * @param db the open connection
 * @returns the figures, or `cancelled` when the statement missed the budget — any OTHER failure throws,
 *   because a store this role cannot census is one the printed command cannot read either
 */
async function census({ db }: { db: ReturnType<typeof drizzle> }): Promise<Census> {
  try {
    const grouped = await db
      .select({ newest: max(contentTable.occurredAt), rows: count(), source: contentTable.source })
      .from(contentTable)
      .groupBy(contentTable.source);
    // Derived from the grouped result rather than asked for a second time: two statements that can each
    // miss the budget independently is two ways for one answer to be half-known.
    const bySource = grouped
      .map((row) => ({ newest: instantOf({ value: row.newest }), rows: row.rows, source: row.source }))
      .toSorted((left, right) => right.rows - left.rows);
    return { bySource, kind: "counted", rows: bySource.reduce((sum, row) => sum + row.rows, 0) };
  } catch (error: unknown) {
    // Only a CANCELLED census is "loaded, extent unknown". Any other failure — the role cannot read
    // `content`, the table is not there, the migration never ran — means the command this row would print
    // cannot read the store either, which is why the two are told apart: were every
    // census error "did not finish in the budget", a role with CONNECT but no SELECT
    // would print as AVAILABLE with a false timeout explanation.
    if (!isStatementCancelled({ error })) {
      throw error;
    }
    return { kind: "cancelled" };
  }
}

/**
 * Read one WHOLE row, so that AVAILABLE means what the printed command reads is readable.
 *
 * The census reads three COLUMNS while retrieval reads the record, which leaves a gap:
 * a role granted `select (source, occurred_at)` and nothing else passes the census and fails
 * `ask --store` with `permission denied for table content` (SQLSTATE 42501).
 *
 * @param db the open connection
 * @returns whether the row read completed, or `cancelled` when it missed the same budget — which is a
 *   REFUSAL, because a cancelled statement proves nothing about permission
 */
async function readsWholeRows({ db }: { db: ReturnType<typeof drizzle> }): Promise<{ cancelled: boolean }> {
  try {
    await db.select().from(contentTable).limit(1);
    return { cancelled: false };
  } catch (error: unknown) {
    if (!isStatementCancelled({ error })) {
      throw error;
    }
    return { cancelled: true };
  }
}

/**
 * Prove reachability, then prove a whole row is readable, then census.
 *
 * @param sql the open connection
 * @param origin which of the two places supplied the selection, reported without its value
 * @returns the observation
 */
async function observed({ sql, origin }: { sql: postgres.Sql; origin: StoreUrlOrigin }): Promise<StoreRouteReading> {
  await sql`select 1`;
  const from =
    origin === "environment"
      ? "SLOPWEAVER_STORE_URL"
      : "the remembered selection under $SLOPWEAVER_HOME/secrets/store-url";
  const db = drizzle(sql);
  // Readability FIRST, extent second, and the order is the fix: a cancelled census must not
  // return "loaded, extent unknown" without proving a whole row can be read, or a role that can
  // count but not SELECT the record would advertise AVAILABLE behind a slow policy. A cancellation proves nothing
  // about permission, so nothing may be claimed on the strength of one.
  const readable = await readsWholeRows({ db });
  if (readable.cancelled) {
    return {
      because:
        `reached, selected from ${from}, but reading one row did not finish in the budget, so whether this ` +
        "store can be read at all is UNPROVEN — a cancelled statement says nothing about permission",
      kind: "unreachable",
    };
  }
  const counted = await census({ db });
  if (counted.kind === "cancelled") {
    return unknownExtent({ from });
  }
  if (counted.rows === 0) {
    return {
      because:
        `reached, selected from ${from}, and it holds no content rows — nothing has been loaded into it yet, so ` +
        "`slopweaver store ingest --source <s> --limit <n> --all` is what fills it",
      kind: "empty",
    };
  }
  return { because: `reached, selected from ${from}`, bySource: counted.bySource, kind: "loaded", rows: counted.rows };
}

/**
 * The reading for a store whose whole-row read SUCCEEDED but whose extent a cancelled census left unknown.
 *
 * Reporting a zero here would be a lie of exactly the kind this module exists to stop: zero reads identically
 * to empty, and only one of those is true.
 *
 * @param from which of the two places supplied the selection
 * @returns the loaded reading with no counts
 */
function unknownExtent({ from }: { from: string }): StoreRouteReading {
  return {
    because: `reached, selected from ${from}; the row census did not finish in the budget`,
    bySource: null,
    kind: "loaded",
    rows: null,
  };
}

/** SQLSTATE 57014, `query_canceled` — what Postgres raises when `statement_timeout` cancels a statement. */
const QUERY_CANCELED = "57014";

/**
 * Whether a census failure was Postgres cancelling the statement at the budget, rather than refusing it.
 *
 * @param error whatever the driver threw
 * @returns true only for SQLSTATE 57014
 */
function isStatementCancelled({ error }: { error: unknown }): boolean {
  // drizzle wraps the driver's error: the SQLSTATE is on the CAUSE, and reading it off the wrapper alone
  // called every cancelled census a refusal (measured: budget 60 ms against a couple of million rows read UNREACHABLE).
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === QUERY_CANCELED;
}

/**
 * Render a `max(occurred_at)` as an ISO instant, or null when the group had none.
 *
 * The driver hands this back as a `Date` for a timestamp column and as a string for some configurations,
 * so both are accepted rather than one assumed. Never scaled from an epoch — there is no arithmetic here,
 * only a value the database already resolved.
 *
 * @param value whatever the aggregate returned for this group
 * @returns the ISO instant, or null
 */
function instantOf({ value }: { value: unknown }): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The first line of a thrown value, so a driver error cannot spill a statement and its bound parameters.
 *
 * The same reason `StoreErrors.queryFailed` caps its own: `postgres.js` builds a message from the failed
 * statement plus every parameter, and a store whose error path prints what it holds is a boundary with a
 * hole in it.
 *
 * @param error the thrown value
 * @returns its first line, capped
 */
function firstLine({ error }: { error: unknown }): string {
  // drizzle wraps the driver's error as `cause` and puts the SQL in `message`; the cause is the reason
  // (`permission denied for table content`), the SQL is not.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  // Index 0 always exists: splitting a string on a non-empty separator yields at least one element.
  return message.split("\n")[0]!.slice(0, 200);
}
