/**
 * The `fathom` noun's shell: argv, the production edges, and the report.
 *
 * `share` reads one share page through the owner's own Chrome (`browser/fathomShare.ts`); `discover` reads
 * Fathom's own mail through the Gmail door's readers, on the read grant only. Neither reaches any other
 * service: the one egress is the page read itself, and the Gmail read is the door `gmail read` already is.
 * `clear-inbox` lives in `./clearInboxRun.ts` and reuses the production edges exported here.
 */

import { relayDepsFor } from "../../../atlas/kit/walkTransport.js";
import { readFathomSharePage } from "../../../browser/fathomShare.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { FATHOM_MAIL_QUERY } from "../../../corpus/fathom/mail.js";
import { readShareTokens } from "../../../corpus/fathom/shareBronze.js";
import { FATHOM_SHARE_ORIGIN, parseFathomShareUrl } from "../../../corpus/fathom/sharePage.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, readGmailListing, readGmailMessage } from "../../../live/gmail/read.js";
import { stateHomePaths } from "../../../stateHome.js";
import { connectStore } from "../../../store/client.js";
import { deleteContentIdentities } from "../../../store/contentRemoval.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { productionStoreIngest } from "../refresh/storeLeg.js";
import { discoverOutputLines, discoverShares, type FathomDiscoverDeps, type FathomMail } from "./discoverCore.js";
import { type FathomShareDeps, type FathomShareOutcome, ingestNewShares, shareLines, shareOne } from "./shareCore.js";
import { FATHOM_DISCOVER_USAGE, FATHOM_SHARE_USAGE, FATHOM_USAGE } from "./usage.js";

/** Where a `fathom` verb's own arguments start: past the runtime, the script, the noun and the verb. */
export const VERB_ARG_OFFSET = 4;

/** Print each line of a failure to stderr. */
export function diagnose({ lines }: { lines: readonly string[] }): void {
  for (const line of lines) {
    logger.error({ msg: line });
  }
}

/** The options `fathom share` takes. */
interface ShareOptions {
  readonly url: string;
  readonly dryRun: boolean;
  readonly store: boolean;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `fathom share`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseShareArgs({ rest }: { rest: readonly string[] }): Result<ShareOptions> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["dry-run", "no-store", "json"], string: ["home"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length !== 1) {
    return err([`expected exactly one share URL, got ${String(positionals.length)}`]);
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : slopweaverHome(),
    json: values["json"] === true,
    store: values["no-store"] !== true,
    url: positionals[0]!,
  });
}

/** The options `fathom discover` takes. */
interface DiscoverOptions {
  readonly ingest: boolean;
  readonly limit: number;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `fathom discover`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseDiscoverArgs({ rest }: { rest: readonly string[] }): Result<DiscoverOptions> {
  const parsed = parseFlags({ args: rest, spec: { boolean: ["ingest", "json"], string: ["home", "limit"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const home = values["home"];
  const rawLimit = values["limit"];
  let limit = DEFAULT_LIST_LIMIT;
  if (typeof rawLimit === "string") {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      return err([`--limit must be a whole number from 1 to ${String(MAX_LIST_LIMIT)}, got ${rawLimit}`]);
    }
  }
  return ok({
    home: typeof home === "string" ? home : slopweaverHome(),
    ingest: values["ingest"] === true,
    json: values["json"] === true,
    limit,
  });
}

/**
 * The production share edges: the owner's Chrome through the relay, and the local store.
 *
 * @returns the page reader and the store leg
 */
export function productionShareDeps(): FathomShareDeps {
  const profiles = recordedProfilePort();
  return {
    readPage: async ({ home, url }) => {
      const deps = await relayDepsFor({
        directory: stateHomePaths({ home }).live.fathom.root,
        home,
        origins: [FATHOM_SHARE_ORIGIN],
        platform: "fathom",
        profiles,
      });
      if (deps.isErr()) {
        return err(deps.error);
      }
      return readFathomSharePage({ deps: deps.value, url });
    },
    storeLeg: async ({ home, retire }) => {
      const opened = await connectStore({ home });
      if (opened.isErr()) {
        return err([opened.error.message]);
      }
      const retired = await deleteContentIdentities({ client: opened.value, source: "fathom", sourceIds: retire });
      await opened.value.close();
      if (retired.isErr()) {
        return err([retired.error.message]);
      }
      const replayed = await productionStoreIngest({ home, source: "fathom" });
      if (replayed.isErr()) {
        return err(replayed.error);
      }
      const stored = replayed.value.kind === "ingested" ? replayed.value.stored : 0;
      return ok({ retired: retired.value, stored });
    },
  };
}

/**
 * The production discovery edges: Fathom's mail through the Gmail door's readers, and fathom bronze.
 *
 * @returns the mail reader and the held-token reader
 */
export function productionDiscoverDeps(): FathomDiscoverDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    fathomMail: async ({ home, limit }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home });
      if (bound.isErr()) {
        return err(bound.error.message);
      }
      const api = makeGmailApi({ account: bound.value.account, client: bound.value.client });
      const listing = await readGmailListing({
        account: bound.value.account,
        api,
        labelIds: [],
        limit,
        nowIso,
        query: FATHOM_MAIL_QUERY,
      });
      if (listing.isErr()) {
        return err(listing.error.message);
      }
      const mails: FathomMail[] = [];
      for (const entry of listing.value.listing.entries) {
        const read = await readGmailMessage({
          account: bound.value.account,
          address: entry.id,
          api,
          nowIso,
          thread: false,
        });
        if (read.isErr()) {
          return err(read.error.message);
        }
        for (const message of read.value.payload.messages) {
          mails.push({
            id: message.id,
            inInbox: message.labelIds.includes("INBOX"),
            sentAtIso: message.sentAtIso,
            subject: message.subject,
            texts: [message.body, ...message.htmlLinks],
          });
        }
      }
      const coverage = {
        matchingEstimate: listing.value.listing.resultSizeEstimate,
        more: listing.value.listing.more,
        read: listing.value.listing.entries.length,
      };
      return ok({ coverage, mails });
    },
    heldTokens: ({ home }) => readShareTokens({ home }),
  };
}

/** The `--json` shape of one share outcome. */
function shareJson({ outcome }: { outcome: FathomShareOutcome }): Record<string, unknown> {
  return { ...outcome };
}

/**
 * Run `fathom share` against injected edges.
 *
 * @param rest the argv after the verb
 * @param deps the page reader and the store leg
 * @returns the process exit code
 */
export async function runFathomShare({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: FathomShareDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FATHOM_SHARE_USAGE });
    return EXIT_OK;
  }
  const options = parseShareArgs({ rest });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, FATHOM_SHARE_USAGE] });
    return EXIT_USAGE;
  }
  const address = parseFathomShareUrl({ url: options.value.url });
  if (address.isErr()) {
    diagnose({ lines: [address.error.message] });
    return EXIT_USAGE;
  }
  const { dryRun, home, json, store } = options.value;
  const outcome = await shareOne({ address: address.value, deps, dryRun, home, store });
  if (outcome.isErr()) {
    diagnose({ lines: [outcome.error.message] });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: JSON.stringify(shareJson({ outcome: outcome.value }), null, 1) });
    return EXIT_OK;
  }
  for (const line of shareLines({ outcome: outcome.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run `fathom discover` against injected edges.
 *
 * @param rest the argv after the verb
 * @param deps the mail and bronze readers
 * @param shareDeps the share edges `--ingest` reads each new link through
 * @returns the process exit code
 */
export async function runFathomDiscover({
  rest,
  deps,
  shareDeps,
}: {
  rest: readonly string[];
  deps: FathomDiscoverDeps;
  shareDeps: FathomShareDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FATHOM_DISCOVER_USAGE });
    return EXIT_OK;
  }
  const options = parseDiscoverArgs({ rest });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, FATHOM_DISCOVER_USAGE] });
    return EXIT_USAGE;
  }
  const { home, ingest, json, limit } = options.value;
  const found = await discoverShares({ deps, home, limit });
  if (found.isErr()) {
    diagnose({ lines: [found.error] });
    return EXIT_ERROR;
  }
  const { coverage, shares } = found.value;
  const report = ingest
    ? await ingestNewShares({ deps: shareDeps, home, shares })
    : { failures: [], outcomes: [], settle: null };
  for (const line of discoverOutputLines({ coverage, json, report, shares })) {
    logger.out({ line });
  }
  diagnose({ lines: report.failures });
  return report.failures.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/** `slopweaver fathom share <url>` — one share page's raw transcript into the fathom source. */
export const fathomShareCommand = defineCommand({
  run: (argv) => runFathomShare({ deps: productionShareDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver fathom discover` — share links in Fathom's mail the fathom source does not hold yet. */
export const fathomDiscoverCommand = defineCommand({
  run: (argv) =>
    runFathomDiscover({
      deps: productionDiscoverDeps(),
      rest: argv.slice(VERB_ARG_OFFSET),
      shareDeps: productionShareDeps(),
    }),
});

/** `slopweaver fathom` with no verb — the noun's own usage. */
export const fathomUsageCommand = defineCommand({
  run: () => {
    logger.out({ line: FATHOM_USAGE });
    return EXIT_OK;
  },
});
