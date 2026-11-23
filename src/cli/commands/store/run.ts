/**
 * `slopweaver store` — the command surface over the typed query layer.
 *
 * A thin effectful shell: every parser and every rendered line is pure (`./core.ts` and its siblings), the query layer
 * is {@link ../../../store/client}, and the loader is {@link ../../../store/ingest}, which `ingest` reaches
 * from its own module, {@link ./ingestRun}, sharing the helpers exported here and from `./shell.ts`.
 * Human report → stderr, `--json` → stdout, pristine, so a pipe still works.
 *
 * The verbs are the four the owner named plus the two an operator needs to run them at all. This module holds
 * `query` (list and filter), `facets` (group and count), `detail` (retrieve one whole) and `identity`;
 * `ingest` (put a bounded slice of bronze in) is `./ingestRun.ts`'s, and `status` (what the store holds,
 * whether it is reachable, and how far behind bronze it sits) is `./statusRun.ts`'s.
 *
 * **No verb here defaults its database.** Every one refuses without `SLOPWEAVER_STORE_URL`, exactly as
 * `store push` does, because a tool that picks its own database is a tool that can run against the
 * wrong one.
 */

import { googleDirectoryFile, writeGoogleDirectory } from "../../../corpus/directory/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { resolveGoogleAdminClient } from "../../../live/googleAdmin/client.js";
import { pullDirectoryUsers } from "../../../live/googleAdmin/directoryUsers.js";
import {
  connectStore,
  contentDetail,
  countContent,
  facetContent,
  listContent,
  type StoreClient,
} from "../../../store/client.js";
import { reconcileIdentities } from "../../../store/identity/reconcile.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  detailLines,
  facetLines,
  listLines,
  parseStoreDetailArgs,
  parseStoreFacetArgs,
  parseStoreReadArgs,
  storeTail,
  vocabularyLines,
} from "./core.js";
import { parseStoreIdentityArgs } from "./identityArgs.js";
import { identityLines } from "./identityLines.js";
import { refuseParsed, refuseWith } from "./shell.js";

const QUERY_USAGE =
  "usage: slopweaver store query [--home <dir>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name|handle|email>] [--since <iso>] [--until <iso>] [--search <text>] [--visibility <v>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--offset <n>] [--json]";
const FACETS_USAGE =
  "usage: slopweaver store facets [--home <dir>] [--facet <f>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name|handle|email>] [--since <iso>] [--until <iso>] [--search <text>] [--visibility <v>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--offset <n>] [--json]";
const DETAIL_USAGE = "usage: slopweaver store detail --source <s> --id <native-id> [--home <dir>] [--json]";
const IDENTITY_USAGE = "usage: slopweaver store identity [--pull] [--home <dir>] [--json]";

/**
 * The `--home` a parsed invocation carried, shaped for {@link openOrRefuse}'s optional field.
 *
 * @param args the parsed verb arguments
 * @returns `{ home }` when the invocation named one, else nothing to spread
 */
export function homeOf({ args }: { args: { readonly home?: string | undefined } }): { home?: string } {
  return args.home === undefined ? {} : { home: args.home };
}

/**
 * Open the store, or print the refusal that names both places a selection can live.
 *
 * @param max how many pooled connections this verb wants
 * @param home the Slopweaver home the remembered selection is read under, when the verb takes `--home`
 * @returns the open client, or the exit code to return
 */
export async function openOrRefuse({ max = 1, home }: { max?: number; home?: string } = {}): Promise<
  { client: StoreClient } | { code: number }
> {
  const opened = await connectStore({ max, ...(home === undefined ? {} : { home }) });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return { code: EXIT_ERROR };
  }
  return { client: opened.value };
}

/**
 * Emit a report, as JSON on stdout or as lines on stderr.
 *
 * @param json whether the caller asked for the machine-readable form
 * @param lines the human report
 * @param payload the machine-readable document
 */
export function emit({ json, lines, payload }: { json: boolean; lines: readonly string[]; payload: unknown }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store report", value: payload }) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/**
 * List the rows a filter selects, newest first.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreQuery(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    [QUERY_USAGE, ...vocabularyLines()].forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  }
  const args = parseStoreReadArgs({ rest });
  if (args.isErr()) {
    return refuseParsed({ error: args.error, usage: QUERY_USAGE });
  }
  const opened = await openOrRefuse(homeOf({ args: args.value }));
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const rows = await listContent({ client: opened.client, query: args.value.query });
    const total = await countContent({ client: opened.client, query: args.value.query });
    if (rows.isErr() || total.isErr()) {
      logger.error({ msg: rows.isErr() ? rows.error.message : String(total.isErr() && total.error.message) });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: listLines({ rows: rows.value, total: total.value }),
      payload: { matched: total.value, rows: rows.value },
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Count the rows a filter selects, grouped by one indexed column.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreFacets(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    [FACETS_USAGE, ...vocabularyLines()].forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  }
  const args = parseStoreFacetArgs({ rest });
  if (args.isErr()) {
    return refuseParsed({ error: args.error, usage: FACETS_USAGE });
  }
  const opened = await openOrRefuse(homeOf({ args: args.value }));
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const counts = await facetContent({ client: opened.client, facet: args.value.facet, query: args.value.query });
    const total = await countContent({ client: opened.client, query: args.value.query });
    if (counts.isErr() || total.isErr()) {
      logger.error({ msg: counts.isErr() ? counts.error.message : String(total.isErr() && total.error.message) });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: facetLines({ counts: counts.value, facet: args.value.facet, total: total.value }),
      payload: { counts: counts.value, facet: args.value.facet, matched: total.value },
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Retrieve one row whole, addressed by the pair a citation already carries.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreDetail(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DETAIL_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreDetailArgs({ rest });
  if (args.isErr()) {
    return refuseWith({ lines: args.error, usage: DETAIL_USAGE });
  }
  const opened = await openOrRefuse(homeOf({ args: args.value }));
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const found = await contentDetail({
      client: opened.client,
      source: args.value.source,
      sourceId: args.value.sourceId,
    });
    if (found.isErr()) {
      logger.error({ msg: found.error.message });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: detailLines({ detail: found.value, source: args.value.source, sourceId: args.value.sourceId }),
      payload: found.value,
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Read the Google Workspace directory through the bound grant and replace the directory bronze with it.
 *
 * @param home the state home whose grant and directory file are used
 * @returns the lines to print, or the refusal
 */
async function pullDirectory({ home }: { home: string }): Promise<Result<readonly string[]>> {
  const bound = resolveGoogleAdminClient({ capabilities: ["directory-users"], home });
  if (bound.isErr()) {
    return err([bound.error.message]);
  }
  const pulled = await pullDirectoryUsers({
    account: bound.value.account,
    client: bound.value.client,
    fetchedAtIso: new Date().toISOString(),
  });
  if (pulled.isErr()) {
    return err(pulled.error);
  }
  const wrote = writeGoogleDirectory({ home, rows: pulled.value.rows });
  if (wrote.isErr()) {
    return err(wrote.error);
  }
  return ok([
    `pulled ${String(pulled.value.rows.length)} directory user(s) over ${String(pulled.value.pages)} page(s) as ${bound.value.account} into ${googleDirectoryFile({ home })}`,
    ...pulled.value.skipped.map((why) => `  skipped: ${why}`),
  ]);
}

/**
 * Build the store's people from the Google Workspace directory and the member pull, and point every
 * content row's author at them — the ONE writer of `person`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreIdentity(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: IDENTITY_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreIdentityArgs({ rest });
  if (args.isErr()) {
    return refuseWith({ lines: args.error, usage: IDENTITY_USAGE });
  }
  const home = args.value.home;
  if (args.value.pull) {
    const { home: pullHome = slopweaverHome() } = args.value;
    const pulled = await pullDirectory({ home: pullHome });
    if (pulled.isErr()) {
      pulled.error.forEach((msg) => {
        logger.error({ msg });
      });
      return EXIT_ERROR;
    }
    if (!args.value.json) {
      pulled.value.forEach((line) => {
        logger.out({ line });
      });
    }
  }
  // `store identity` reconciles THAT home's member files — so its database selection has to come from the
  // same home, not from the default one. Every other verb here takes `--home` for the brief's sake (see
  // `QUERY_FLAGS` in ./core.ts); this one needs it for its own.
  const opened = await openOrRefuse({ max: 2, ...(home === undefined ? {} : { home }) });
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const report =
      home === undefined
        ? await reconcileIdentities({ client: opened.client })
        : await reconcileIdentities({ client: opened.client, home });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    emit({ json: args.value.json, lines: identityLines({ report: report.value }), payload: report.value });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

export const storeQueryCommand = defineCommand({ run: runStoreQuery });
export const storeFacetsCommand = defineCommand({ run: runStoreFacets });
export const storeDetailCommand = defineCommand({ run: runStoreDetail });
export const storeIdentityCommand = defineCommand({ run: runStoreIdentity });
