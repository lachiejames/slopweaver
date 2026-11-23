/**
 * Where the store's connection string comes from — and why remembering one is not the same as guessing one.
 *
 * ## The two doctrines this sits between
 *
 * `docs/store/overview-and-local-stack.md` states as a deliberate property that no verb here defaults its database: "a tool that
 * picks its own database is a tool that can run against the wrong one". `AGENTS.md` states the opposite-
 * looking rule for per-install values — "tools in the codebase, state outside it": a host, slug or id
 * resolves at runtime from `$SLOPWEAVER_HOME`, never from a constant.
 *
 * Both hold, because they are about different things. The first forbids the tool CHOOSING a database; the
 * second forbids a chosen database living in the repository. So the operator selects it once, explicitly,
 * and the selection is remembered outside the codebase — in the credential store, at `0600`, beside every
 * other per-install value. Nothing here synthesises a host, a port, a database name or a password, and a
 * store that was never selected still REFUSES.
 *
 * ## Why the environment still wins
 *
 * `SLOPWEAVER_STORE_URL` stays the first thing read, so a one-off run against a throwaway Postgres — which
 * is how every measurement in `docs/store.md` was taken — keeps working without touching the store the
 * install actually uses.
 *
 * ## Local only, at the URL
 *
 * The store works only with a local database. The archive switched
 * between local, staging and production by env file; this store has one kind of database, so the
 * selection is refused HERE — before any verb connects — when its host is not loopback. The refusal is a
 * HOLD with no escape hatch: the owner's ruling is that the store is always a local database on
 * this machine, a hard rule, so no environment variable, flag or grant admits another host — a hosted Postgres, a
 * LAN address and a tunnel's far end alike. `store backup` is disaster recovery, a copy rather than a store, and
 * is a separate boundary.
 *
 * ## What this closed, measured
 *
 * MEASURED on this checkout: `grep -rn SLOPWEAVER_STORE_URL --include='*.ts' src` found the
 * variable read in exactly two modules and set by nothing under `src/live/`, `src/cli/commands/turn/` or
 * `skills/`. So the store-backed read in a bot turn printed "refusing to reach the store"
 * and exited 1, while the `corpus` capability row declared itself available — and the turn answered
 * from bronze files instead. That is the failure mode the owner names: a path that went to local markdown files when it should have gone to the local store. Reproduce
 * the old shape with `env -u SLOPWEAVER_STORE_URL` and an empty home.
 */
import { tokenFromEnvOrHomeFile } from "../config.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  StoreErrors,
  type StoreRetiredCopyUnremovedError,
  type StoreUrlMissingError,
  type StoreUrlRemoteError,
} from "./errors.js";
import { isLocalHost, isLocalStoreUrl } from "./localStoreUrl.js";
import { connectionHosts } from "./lock/macLogin.js";
import { removeRetiredStorageCopies } from "./objects/retiredCopies.js";

/**
 * The environment variable holding the store's connection string.
 *
 * Named rather than inlined so the refusal message and the reader agree about what to set — a mismatch
 * there is how an operator ends up exporting a variable nothing reads.
 */
export const STORE_URL_ENV = "SLOPWEAVER_STORE_URL";

/**
 * The credential-store file the selection is remembered in, under `$SLOPWEAVER_HOME/secrets`.
 *
 * A connection string carries a password, so it is stored the way every other credential here is rather
 * than in a world-readable config file. Its register row (`src/secrets/credentials/storeAndBackup.ts`) is what makes
 * `slopweaver secrets set store-url` accept it at all.
 */
export const STORE_URL_SECRET = "store-url";

/**
 * Every way the store can refuse to be selected: no URL at all, one that reaches another machine, or a
 * retired Storage copy that would not be removed.
 */
export type StoreSelectionError = StoreUrlMissingError | StoreUrlRemoteError | StoreRetiredCopyUnremovedError;

/** Where a resolved connection string came from, so a report can say so without printing the value. */
export type StoreUrlOrigin = "environment" | "secret";

/** A resolved store selection: the connection string, and which of the two places supplied it. */
export interface StoreUrlSelection {
  readonly url: string;
  readonly origin: StoreUrlOrigin;
}

/**
 * Read the store's connection string, refusing rather than defaulting to one.
 *
 * `SLOPWEAVER_STORE_URL` first, then `$SLOPWEAVER_HOME/secrets/store-url`. Neither present is a refusal
 * naming both, because an operator told only about the variable will export it into one shell and find
 * every later process refusing again.
 *
 * @param home the Slopweaver home to read the secret under — passed through rather than defaulted by the
 *   caller's caller, so a verb running under `--home` cannot read one home's selection while writing
 *   another home's data
 * @param env the environment to resolve {@link STORE_URL_ENV} from, so a test can say "nothing is set"
 *   without depending on the ambient shell
 * @returns the selection and its origin, or the typed refusal naming both places, the remote host, or the
 *   retired copy that would not go
 */
export function storeUrlSelection({
  home,
  env: environment = process.env,
}: {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
} = {}): Result<StoreUrlSelection, StoreSelectionError> {
  // Every path to the store selects it here, so this is where an upgraded home sheds its retired copies of
  // the Storage address and key — whether or not a store is selected, and whether or not Storage is reached.
  const removed = removeRetiredStorageCopies(home === undefined ? {} : { home });
  if (removed.isErr()) {
    return err(StoreErrors.retiredCopyUnremoved({ path: removed.error.path }));
  }
  const fromEnv = environment[STORE_URL_ENV];
  const trimmedEnv = fromEnv === undefined ? "" : fromEnv.trim();
  if (trimmedEnv.length > 0) {
    return localOnly({ selection: { origin: "environment", url: trimmedEnv } });
  }
  const fromSecret = tokenFromEnvOrHomeFile({
    envNames: [],
    secretName: STORE_URL_SECRET,
    ...(home === undefined ? {} : { home }),
    env: environment,
  });
  if (fromSecret === undefined) {
    return err(StoreErrors.urlMissing({ envVar: STORE_URL_ENV, secretName: STORE_URL_SECRET }));
  }
  return localOnly({ selection: { origin: "secret", url: fromSecret } });
}

/**
 * Admit a selection only when it reaches this machine — unconditionally, because the owner ruled the store
 * local only and no hatch exists to read.
 *
 * @param selection the resolved selection
 * @returns the selection, or the hold naming the host and saying no hatch opens it
 */
function localOnly({ selection }: { selection: StoreUrlSelection }): Result<StoreUrlSelection, StoreSelectionError> {
  if (isLocalStoreUrl({ url: selection.url })) {
    return ok(selection);
  }
  return err(StoreErrors.urlRemote({ host: hostOf({ url: selection.url }) }));
}

/**
 * The host a connection string would have reached, for a refusal that names it: the first host the store's client
 * would try that is not loopback, else the URL's own hostname.
 *
 * @param url the connection string
 * @returns that host, or the literal `(unparseable)` when the string is not a URL
 */
function hostOf({ url }: { url: string }): string {
  if (!URL.canParse(url)) {
    return "(unparseable)";
  }
  const hostname = new URL(url).hostname;
  const hosts = connectionHosts({ url });
  if (hosts === null) {
    return hostname;
  }
  const away = hosts.find((host) => !isLocalHost({ host }));
  if (away !== undefined) {
    return away;
  }
  return hostname;
}

/**
 * The connection string alone, for the callers that only ever open a connection with it.
 *
 * @param home the Slopweaver home to read the remembered selection under
 * @param env the environment to resolve {@link STORE_URL_ENV} from
 * @returns the connection string, or the typed refusal naming where to put one
 */
export function storeUrl({
  home,
  env,
}: {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
} = {}): Result<string, StoreSelectionError> {
  return storeUrlSelection({ ...(home === undefined ? {} : { home }), ...(env === undefined ? {} : { env }) }).map(
    (selection) => selection.url,
  );
}
