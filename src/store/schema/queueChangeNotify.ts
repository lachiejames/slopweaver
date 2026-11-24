/**
 * The store's half of the console Queue's change push: a trigger on every table a Queue register is read from,
 * notifying one channel with the register's slug when a write to it commits.
 *
 * The console's Queue used to learn about a change by re-running each register's verb every twenty seconds. The
 * registers kept in files are watched on disk (`site/lib/liveChangesServer.ts`); the six read here are told by
 * Postgres itself, through a `LISTEN` the console server holds open in-process (`site/lib/storeQueuePostgres.ts`,
 * whose restated trigger list `site/__tests__/unit/storeQueueCore.test.ts` pins to this one). A notification
 * is delivered only when its transaction COMMITS, so a rolled-back write moves nothing, and Postgres folds identical
 * payloads within one transaction into one.
 *
 * Installed by the apply's guard phase (`../migrate.ts` `postMigrationStatements`) the same way as the staging guards
 * (`./importStaging.ts`): every function first, then each trigger by `create or replace trigger`, `enable always` in
 * the same statement so a session in replica mode still fires it. A store whose apply never reached that phase lacks
 * them, so `store watch-queue` checks with {@link missingQueueChangeTriggers} before saying it is listening: a
 * listener on a store that never notifies would report the Queue current while it went stale.
 */

/** The one channel every Queue notification is sent on. */
export const QUEUE_CHANGE_CHANNEL = "slopweaver_queue_change";

/** The Queue registers kept in the store, by their live verb's slug. */
export const QUEUE_STORE_SLUGS = [
  "autonomy",
  "board",
  "import-questions",
  "reviewers",
  "standing-asks",
  "workstreams",
] as const;

/** One Queue register kept in the store. */
export type QueueStoreSlug = (typeof QUEUE_STORE_SLUGS)[number];

/** One notify trigger: its name, its table, the register it names, and the clause that fires it. */
export interface QueueChangeTrigger {
  readonly name: string;
  readonly table: string;
  readonly slug: QueueStoreSlug;
  /** Everything after `create or replace trigger <name>`: the timing, the events, the table and the function. */
  readonly fires: string;
}

/**
 * Every table each store-kept register is read from, following each verb into its store module: the unanswered import
 * questions (`store/transfer/importAnswers.ts`), the workstream register (`workstreams/store/rows.ts`), the standing asks
 * (`profile/standingAskStore.ts`), the autonomy register (`store/fleet/autonomyStore.ts`), and the owner's stored name
 * the board reads to tell a pause on the owner (`cli/commands/handover/pauseOwnerCheck.ts`). A register read from ONE
 * row of a table other registers share is in {@link QUEUE_KEYED_ROWS} instead.
 */
const QUEUE_STORE_TABLES: readonly { table: string; slug: QueueStoreSlug }[] = [
  { slug: "import-questions", table: "store_import_batch" },
  { slug: "import-questions", table: "store_import_question" },
  { slug: "import-questions", table: "store_import_resolution" },
  { slug: "workstreams", table: "workstream" },
  { slug: "workstreams", table: "workstream_register_meta" },
  { slug: "workstreams", table: "workstream_milestone" },
  { slug: "workstreams", table: "workstream_milestone_after" },
  { slug: "workstreams", table: "workstream_entry" },
  { slug: "workstreams", table: "workstream_link" },
  { slug: "standing-asks", table: "standing_ask" },
  { slug: "standing-asks", table: "standing_ask_coverage" },
  { slug: "standing-asks", table: "standing_ask_event" },
  { slug: "autonomy", table: "autonomy_event" },
  { slug: "autonomy", table: "autonomy_register" },
  { slug: "board", table: "owner_profile" },
];

/**
 * A register read from one row of a shared table: the identity roster singleton, which the reviewers resolve against
 * and the board reads the owner's names from (`cli/commands/handover/pauseOwnerCheck.ts`), and the standing asks'
 * import marker, which `profile standing --json` checks against the event count on every read
 * (`store/registerImportRows.ts` `countedImportMarker`). Any other row of either table moves no Queue register.
 */
const QUEUE_KEYED_ROWS: readonly { table: string; column: string; value: string; slug: QueueStoreSlug }[] = [
  { column: "id", slug: "reviewers", table: "singleton_register", value: "identity-roster" },
  { column: "id", slug: "board", table: "singleton_register", value: "identity-roster" },
  { column: "register", slug: "standing-asks", table: "home_file_import", value: "standing-asks" },
];

/** A trigger's name: its table and register, so two registers read from one table each get their own. */
function triggerName({ table, slug, suffix }: { table: string; slug: QueueStoreSlug; suffix: string }): string {
  return `trg_${table}_${slug.replaceAll("-", "_")}_queue_change${suffix}`;
}

/**
 * Every notify trigger. A statement trigger per table, so a statement writing a thousand rows notifies once; it also
 * fires for a foreign key's cascaded delete. A keyed row's table has a row trigger, because a statement trigger cannot
 * see which row it wrote, plus a statement trigger for `truncate`, which fires no row trigger.
 */
export const QUEUE_CHANGE_TRIGGERS: readonly QueueChangeTrigger[] = [
  ...QUEUE_STORE_TABLES.map(({ table, slug }): QueueChangeTrigger => ({
    fires: `after insert or update or delete or truncate on public.${table} for each statement execute function public.queue_change_notify('${slug}')`,
    name: triggerName({ slug, suffix: "", table }),
    slug,
    table,
  })),
  ...QUEUE_KEYED_ROWS.flatMap(({ table, column, value, slug }): QueueChangeTrigger[] => [
    {
      fires: `after insert or update or delete on public.${table} for each row execute function public.queue_change_notify_row('${column}', '${value}', '${slug}')`,
      name: triggerName({ slug, suffix: "", table }),
      slug,
      table,
    },
    {
      fires: `after truncate on public.${table} for each statement execute function public.queue_change_notify('${slug}')`,
      name: triggerName({ slug, suffix: "_truncate", table }),
      slug,
      table,
    },
  ]),
];

/**
 * The two functions the triggers run, each with an empty `search_path` for the reason `./importStaging.ts` gives. The
 * slug is the trigger's own argument, so one function serves every table; the keyed one also takes the column and the
 * value that pick its row. A row trigger's `old` is a null row on an insert and its `new` a null row on a delete, so
 * each side's key reads null there rather than failing, and an update moving the key notifies for either side.
 */
const QUEUE_CHANGE_FUNCTIONS: readonly string[] = [
  `create or replace function public.queue_change_notify() returns trigger language plpgsql set search_path = '' as $$
      begin
        perform pg_notify('${QUEUE_CHANGE_CHANNEL}', tg_argv[0]);
        return null;
      end $$`,
  `create or replace function public.queue_change_notify_row() returns trigger language plpgsql set search_path = '' as $$
      begin
        if (tg_op <> 'INSERT' and pg_catalog.to_jsonb(old) ->> tg_argv[0] = tg_argv[1])
          or (tg_op <> 'DELETE' and pg_catalog.to_jsonb(new) ->> tg_argv[0] = tg_argv[1]) then
          perform pg_notify('${QUEUE_CHANGE_CHANNEL}', tg_argv[2]);
        end if;
        return null;
      end $$`,
];

/**
 * The statements that install every notify trigger idempotently: both functions, then each trigger, enabled ALWAYS in
 * the same `do` block so a re-apply never leaves a window with the trigger firing in origin mode only.
 */
export const QUEUE_CHANGE_NOTIFY_STATEMENTS: readonly string[] = [
  ...QUEUE_CHANGE_FUNCTIONS,
  ...QUEUE_CHANGE_TRIGGERS.map(
    (trigger) =>
      `do $$ begin
        create or replace trigger ${trigger.name} ${trigger.fires};
        alter table public.${trigger.table} enable always trigger ${trigger.name};
      end $$`,
  ),
];

/**
 * Which notify triggers a store lacks, given the triggers it reports enabled ALWAYS. One disabled, or reset to fire in
 * origin mode only, is missing too.
 *
 * @param installed every trigger the store reports enabled ALWAYS, by table and name
 * @returns the names of the notify triggers absent from it, in declaration order; empty when every one is there
 */
export function missingQueueChangeTriggers({
  installed,
}: {
  installed: readonly { table: string; name: string }[];
}): readonly string[] {
  const present = new Set(installed.map((trigger) => `${trigger.table}.${trigger.name}`));
  return QUEUE_CHANGE_TRIGGERS.filter((trigger) => !present.has(`${trigger.table}.${trigger.name}`)).map(
    (trigger) => trigger.name,
  );
}

/**
 * The register one notification names, or `undefined` for a payload no trigger here sends.
 *
 * @param payload the notification's text
 * @returns the store-kept register it names
 */
export function queueStoreSlugOf({ payload }: { payload: string }): QueueStoreSlug | undefined {
  return QUEUE_STORE_SLUGS.find((slug) => slug === payload);
}
