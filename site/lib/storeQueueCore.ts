/**
 * The store half of the Queue's change push, as the console server needs it: which channel the notify triggers send
 * on, which triggers a store must carry before a `LISTEN` on it means anything, which store a console may listen to,
 * and the register one notification names. Pure: the Postgres connection is `./storeQueuePostgres.ts`'s and the
 * listen loop `./storeQueueWatch.ts`'s.
 *
 * Restated rather than imported, because `site/` never imports `src/`: the triggers are declared and installed by
 * `src/store/schema/queueChangeNotify.ts`, the store selection is `src/store/config.ts`'s `storeUrlSelection`, and the
 * loopback set is `src/store/lifecycleCore.ts`'s. `site/__tests__/unit/storeQueueCore.test.ts` pins the channel, the
 * slugs and every trigger's table and name against `src/`'s, so the two cannot drift.
 */
import { err, ok, type Result } from "neverthrow";

import { type QueueLiveSlug, queueSlugsForSource } from "./queueLiveChanges";

/** The one channel every Queue notification is sent on. */
export const STORE_QUEUE_CHANNEL = "slopweaver_queue_change";

/** How often the listener proves the store still answers, with a real round trip. */
export const STORE_QUEUE_HEARTBEAT_MS = 15_000;

/** The Queue registers kept in the store, by their live verb's slug. */
export const STORE_QUEUE_SLUGS = [
  "autonomy",
  "board",
  "import-questions",
  "reviewers",
  "standing-asks",
  "workstreams",
] as const satisfies readonly QueueLiveSlug[];

/** One Queue register kept in the store. */
export type StoreQueueSlug = (typeof STORE_QUEUE_SLUGS)[number];

/** Every table a store-kept register is read from whole, with a statement trigger each. */
const WHOLE_TABLES: readonly { table: string; slug: StoreQueueSlug }[] = [
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

/** Every shared table a register reads one row of, with a row trigger and a truncate trigger each. */
const KEYED_TABLES: readonly { table: string; slug: StoreQueueSlug }[] = [
  { slug: "reviewers", table: "singleton_register" },
  { slug: "board", table: "singleton_register" },
  { slug: "standing-asks", table: "home_file_import" },
];

/** A trigger's name, spelled exactly as the store's declaration spells it. */
function triggerName({ table, slug, suffix }: { table: string; slug: StoreQueueSlug; suffix: string }): string {
  return `trg_${table}_${slug.replaceAll("-", "_")}_queue_change${suffix}`;
}

/** Every notify trigger a store must carry, enabled ALWAYS, for its `LISTEN` to hear every store-kept register. */
export const STORE_QUEUE_TRIGGERS: readonly { readonly table: string; readonly name: string }[] = [
  ...WHOLE_TABLES.map(({ table, slug }) => ({ name: triggerName({ slug, suffix: "", table }), table })),
  ...KEYED_TABLES.flatMap(({ table, slug }) => [
    { name: triggerName({ slug, suffix: "", table }), table },
    { name: triggerName({ slug, suffix: "_truncate", table }), table },
  ]),
];

/** What one listen loop tells the broker. */
export type StoreQueueEvent =
  | { readonly kind: "ready" }
  | { readonly kind: "changed"; readonly slug: StoreQueueSlug }
  | { readonly kind: "heartbeat"; readonly atMs: number };

/** What the broker does with one listener event. */
export interface StoreEventEffect {
  /** Whether the event proves the listener alive, resetting its silence clock. */
  readonly alive: boolean;
  /** Whether the event says the store signal is up. */
  readonly up: boolean;
  /** The registers owed a re-read. */
  readonly slugs: readonly QueueLiveSlug[];
}

/**
 * What one listener event means to the broker. Every `ready` owes a re-read of every store-kept register, a second one
 * while the signal is already up included: it follows a re-established `LISTEN`, and what committed while that was down
 * was never delivered.
 *
 * @param event what the listen loop said
 * @returns whether it proves the listener alive, whether the signal is up, and which registers to re-read
 */
export function storeEventEffect({ event }: { event: StoreQueueEvent }): StoreEventEffect {
  switch (event.kind) {
    case "ready":
      return { alive: true, slugs: queueSlugsForSource({ source: "store" }), up: true };
    case "heartbeat":
      return { alive: true, slugs: [], up: false };
    case "changed":
      return { alive: false, slugs: [event.slug], up: false };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** No store selected: neither the variable nor the secret holds a connection string. */
export interface StoreQueueUrlMissingError {
  readonly code: "STORE_URL_MISSING";
  readonly message: string;
}

/** A store selected off this machine, which the console never listens to. */
export interface StoreQueueUrlRemoteError {
  readonly code: "STORE_URL_REMOTE";
  readonly message: string;
}

/** Why the console has no store to listen to. */
export type StoreQueueSelectionError = StoreQueueUrlMissingError | StoreQueueUrlRemoteError;

/** The selection refusals, named here so the page never sees a connection string. */
export const StoreQueueSelectionErrors = {
  remote: (): StoreQueueUrlRemoteError => ({
    code: "STORE_URL_REMOTE",
    message: "the selected store is not on this machine, so the console does not listen to it",
  }),
  urlMissing: (): StoreQueueUrlMissingError => ({
    code: "STORE_URL_MISSING",
    message: "no store is selected: SLOPWEAVER_STORE_URL and secrets/store-url are both empty",
  }),
} as const;

/** The hosts that are this machine, as `src/store/lifecycleCore.ts` lists them. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * The store the console listens to: `SLOPWEAVER_STORE_URL` when it holds anything, else the home's `store-url` secret,
 * and never one off this machine. The CLI admits a remote store behind a journalled hatch; the console does not, so
 * such a store's signal stays down and its registers keep their old poll.
 *
 * @param environmentValue `SLOPWEAVER_STORE_URL` as the console's environment holds it
 * @param secretValue the home's `secrets/store-url` file's text, `undefined` when there is no such file
 * @returns the connection string, or which refusal applies
 */
export function selectStoreQueueUrl({
  environmentValue,
  secretValue,
}: {
  environmentValue: string | undefined;
  secretValue: string | undefined;
}): Result<string, StoreQueueSelectionError> {
  const fromEnvironment = environmentValue === undefined ? "" : environmentValue.trim();
  const fromSecret = secretValue === undefined ? "" : secretValue.trim();
  let url: string;
  if (fromEnvironment !== "") {
    url = fromEnvironment;
  } else if (fromSecret !== "") {
    url = fromSecret;
  } else {
    return err(StoreQueueSelectionErrors.urlMissing());
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return err(StoreQueueSelectionErrors.remote());
  }
  return LOOPBACK_HOSTS.has(host) ? ok(url) : err(StoreQueueSelectionErrors.remote());
}

/**
 * Which notify triggers a store lacks, given the triggers it reports enabled ALWAYS.
 *
 * @param installed every trigger the store reports enabled ALWAYS, by table and name
 * @returns the names absent from it, in declaration order; empty when every one is there
 */
export function missingStoreQueueTriggers({
  installed,
}: {
  installed: readonly { table: string; name: string }[];
}): readonly string[] {
  const present = new Set(installed.map((trigger) => `${trigger.table}.${trigger.name}`));
  return STORE_QUEUE_TRIGGERS.filter((trigger) => !present.has(`${trigger.table}.${trigger.name}`)).map(
    (trigger) => trigger.name,
  );
}

/**
 * The register one notification names.
 *
 * @param payload the notification's text
 * @returns the store-kept register it names, or `undefined` for a payload no trigger here sends
 */
export function storeQueueSlugOf({ payload }: { payload: string }): StoreQueueSlug | undefined {
  return STORE_QUEUE_SLUGS.find((slug) => slug === payload);
}
