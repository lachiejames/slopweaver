/**
 * What the door's catch-up reads out of the DATABASE before it applies anything: the added objects an additive
 * statement could run without naming them, and the ledger instant drizzle's migrator selects by. Split from
 * `./catchUp.ts`, which judges the files and applies, so each read is one short connection with one question.
 */
import postgres from "postgres";

import { err, ok, type Result } from "../lib/result.js";

import { admittedCallNames, migratorSelectionMismatch } from "./catchUpCore.js";
import { type StoreError, StoreErrors } from "./errors.js";
import type { JournalMigration } from "./lifecycleCore.js";

/**
 * Every object ADDED to the database — an oid at or past 16384, Postgres's `FirstNormalObjectId`, so anything
 * `initdb` did not create, in ANY schema — that runs code an expression reaches without naming a function. Judged by
 * oid, not schema: the search path resolves an unqualified operator or function through `"$user"`, `::other.domain` names a type in any schema without a `(` the text check would see, and a superuser can
 * create `pg_catalog.lower(integer)` beside the built-in, while `pg_catalog`'s own SQL-language
 * `timestamptz(date, time)` is stock and below the line. The objects: an added operator, or one backed by an added
 * function; an added cast — a `WITH INOUT` or binary-coercible one has no function at all (`castfunc = 0`) and always
 * counts; an added domain (its CHECK runs on a cast); an added function under any name the text check
 * admits ({@link ./catchUpCore.admittedCallNames}, bound as `$1`), which overload resolution can pick in place of the
 * built-in the allowlist meant; an added operator class or family's support function, which an
 * admitted `CREATE INDEX … (col some_ops)` runs once per comparison while it builds; an event trigger
 * whose function is in `public` (it runs on DDL).
 * A superuser REPLACING a built-in in place keeps its `initdb` oid and is not read: it changes what every statement
 * does, `slopweaver store push` included.
 *
 * What is excused is code in C or `internal`, which only a superuser installs: pgvector's operators, casts and
 * `vector()`. Extension membership excuses nothing on its own — the owner of an extension can `ALTER EXTENSION … ADD`
 * a SQL `public.now()` to it — so an extension-owned domain passes only when every function
 * and operator its constraints depend on is C or `internal` (pg_net's `http_method`, an `IN` list over text equality),
 * and only when it carries no DEFAULT: an added column of that type is filled by evaluating the default once per
 * existing row, and a default can call anything (Codex r29).
 *
 * An event trigger whose function lives OUTSIDE `public` is deliberately not read (Codex r11, refused on the merits):
 * only a superuser creates one, the store's own role is not one, and it fires on every DDL statement by any route —
 * `slopweaver store push` of the same file included — so the catch-up reaches nothing it would not. The platform's
 * six (`pgrst_ddl_watch` and its kin, in `extensions`) are exactly that kind, and declining on them would refuse
 * every catch-up there is.
 *
 * One arm is a takeover rather than code: an index on a partition that no parent index has attached. A new index on
 * the partitioned parent — `CREATE INDEX`, or an added UNIQUE or PRIMARY KEY — ATTACHES an equivalent unattached one
 * instead of building its own, after which it can no longer be dropped on its own. An index
 * a partition was created with is attached already, so the store's own seven `realtime.messages` partitions read none.
 */
const REACHABLE_CODE_QUERY = `
  with extension_owned as (select classid, objid from pg_depend where deptype = 'e'),
       superuser_code as (select p.oid from pg_proc p join pg_language l on l.oid = p.prolang
                           where l.lanname in ('c','internal'))
  select 'operator ' || o.oprname || ' (' || o.oprcode::regproc::text || ')' as line
    from pg_operator o
   where (o.oid >= 16384 or o.oprcode::oid >= 16384)
     and o.oprcode not in (select oid from superuser_code)
  union all
  select 'cast ' || format_type(c.castsource, null) || ' as ' || format_type(c.casttarget, null)
    from pg_cast c
   where c.oid >= 16384
     and (c.castfunc = 0 or c.castfunc not in (select oid from superuser_code))
  union all
  select 'domain ' || t.typname
    from pg_type t
   where t.typtype = 'd' and t.oid >= 16384
     and (t.typdefaultbin is not null or t.typdefault is not null
          or ('pg_type'::regclass::oid,t.oid) not in (select classid, objid from extension_owned)
          or exists (select 1
                       from pg_constraint k
                       join pg_depend d on d.classid = 'pg_constraint'::regclass and d.objid = k.oid
                       left join pg_operator o on d.refclassid = 'pg_operator'::regclass and o.oid = d.refobjid
                      where k.contypid = t.oid
                        and ((d.refclassid = 'pg_proc'::regclass and d.refobjid not in (select oid from superuser_code))
                             or o.oprcode not in (select oid from superuser_code))))
  union all
  select 'function ' || f.proname || ' carries a name the additive check admits'
    from pg_proc f
   where f.oid >= 16384
     and lower(f.proname) = any($1::text[])
     and f.oid not in (select oid from superuser_code)
  union all
  select 'index support function ' || a.amproc::regproc::text
    from pg_amproc a
   where a.amproc::oid >= 16384
     and a.amproc not in (select oid from superuser_code)
  union all
  select 'event trigger ' || e.evtname
    from pg_event_trigger e
    join pg_proc p on p.oid = e.evtfoid
   where p.pronamespace = 'public'::regnamespace
  union all
  select 'unattached index ' || i.relname || ' on partition ' || t.relname
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
   where t.relispartition and not exists (select 1 from pg_inherits h where h.inhrelid = i.oid)
  order by 1`;

/**
 * Read {@link REACHABLE_CODE_QUERY} over its own short connection.
 *
 * @param url the connection string the door selected
 * @returns one line per such object, empty when there is none
 * @internal — `./catchUp.ts` is the one caller
 */
export async function reachableCode({ url }: { url: string }): Promise<Result<readonly string[], StoreError>> {
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const rows = await sql.unsafe<{ line: string }[]>(REACHABLE_CODE_QUERY, [[...admittedCallNames()]]);
    return ok(rows.map((row) => row.line));
  } catch (error: unknown) {
    return err(
      StoreErrors.queryFailed({
        cause: error,
        what: "reading the store's operators, casts, domains and event triggers",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Why drizzle's migrator would apply other than exactly the judged entries, read off the ledger's latest
 * `created_at` exactly as the migrator reads it ({@link ./catchUpCore.migratorSelectionMismatch}).
 *
 * @param url the connection string the door selected
 * @param journal every journal entry of the snapshot being judged
 * @param applied how many entries the door classified as recorded
 * @returns the decline's reason, or undefined when the migrator selects exactly the pending entries
 * @internal — `./catchUp.ts` is the one caller
 */
export async function migratorSelectionDeclined({
  url,
  journal,
  applied,
}: {
  url: string;
  journal: readonly JournalMigration[];
  applied: number;
}): Promise<Result<string | undefined, StoreError>> {
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const rows = await sql<{ created_at: string | null }[]>`
      select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
    const row = rows[0];
    const lastRecordedAt = row === undefined ? undefined : Number(row.created_at);
    const mismatch = migratorSelectionMismatch({ applied, journal, lastRecordedAt });
    return ok(mismatch.length === 0 ? undefined : `not caught up, because ${mismatch.join("; ")}`);
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "reading the migrator's last recorded instant" }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
