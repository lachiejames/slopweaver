/**
 * `slopweaver proposal sync` — the effectful shell. Discovers `child_page` blocks directly under one or more
 * Notion source pages and registers each one not already tracked under that Notion address. It is a Notion
 * child-page IMPORT, not a sync of whatever destination the install publishes to: no other provider has a
 * bounded discovery read to compose. It is `local-state`, never
 * `external-write`: it reads Notion and writes only under `$SLOPWEAVER_HOME`, the same classification
 * `refresh` already carries for network ingestion that persists locally.
 *
 * It never assigns a status, decision, successor, audience or Slack link — see `../../../outbound/proposal/
 * register/sync.ts` for why that stays a human (or the session driving this CLI) reading each candidate page.
 */
import { notionToken } from "../../../config.js";
import { makeNotionNamedReadApi, type NotionNamedBlockPage } from "../../../corpus/notion/liveApi.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type NotionLiveError, NotionLiveErrors } from "../../../live/notion/errors.js";
import { parseNotionReadAddress } from "../../../live/notion/read.js";
import {
  addressIdentityKey,
  addressLabel,
  notionPageAddress,
  type ProposalAddress,
} from "../../../outbound/proposal/address.js";
import type { RegisterEntry } from "../../../outbound/proposal/register/events.js";
import { deriveRegisterSlug } from "../../../outbound/proposal/register/identity.js";
import {
  appendRegisterEvent,
  listRegisterSlugs,
  loadRegisterEntry,
} from "../../../outbound/proposal/register/store.js";
import { canonicalNotionUrl, childPagesOf, type SyncCandidate } from "../../../outbound/proposal/register/sync.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { proposalErrorLines } from "./errors.js";
import { parseProposalSyncArgs } from "./syncCore.js";

/** Where a verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies a plain function reading synthetic pages; nothing here is a mock. */
export interface ProposalSyncDeps {
  readonly now: () => Date;
  readonly readSourceBlocks: (args: {
    address: string;
    limit: number;
    home: string;
  }) => Promise<Result<NotionNamedBlockPage, NotionLiveError>>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: ProposalSyncDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** What sync needs to know about one register entry: its slug and the address it tracks. */
type Tracked = Pick<RegisterEntry, "address" | "slug">;

/**
 * Every currently-registered entry, keyed by provider and id, so a candidate already tracked can be recognised
 * — and a Linear or local entry that happens to share a Notion page's id is never mistaken for it.
 */
function registeredByAddress({ home }: { home: string }): Map<string, Tracked> {
  const byAddress = new Map<string, Tracked>();
  for (const slug of listRegisterSlugs({ home })) {
    const loaded = loadRegisterEntry({ home, slug });
    if (loaded.isOk() && loaded.value !== undefined) {
      byAddress.set(addressIdentityKey({ address: loaded.value.address }), loaded.value);
    }
  }
  return byAddress;
}

/** One candidate resolved against the current register: already tracked, a slug conflict, or new. */
type CandidateOutcome =
  | { readonly kind: "already-registered"; readonly candidate: SyncCandidate; readonly slug: string }
  | {
      readonly kind: "slug-conflict";
      readonly candidate: SyncCandidate;
      readonly slug: string;
      readonly conflicting: ProposalAddress;
    }
  | {
      readonly kind: "new";
      readonly candidate: SyncCandidate;
      readonly address: ProposalAddress;
      readonly slug: string;
    };

/** Resolve one candidate against the register as it stands, this run's own registrations included. */
function resolveCandidate({
  candidate,
  byAddress,
  bySlug,
}: {
  candidate: SyncCandidate;
  byAddress: ReadonlyMap<string, Tracked>;
  bySlug: ReadonlyMap<string, Tracked>;
}): CandidateOutcome {
  // Sync imports Notion child pages, so every candidate is a Notion address, at the bare-id URL Notion redirects.
  const address = notionPageAddress({
    pageId: candidate.pageId,
    pageUrl: canonicalNotionUrl({ pageId: candidate.pageId }),
  });
  const alreadyTracked = byAddress.get(addressIdentityKey({ address }));
  if (alreadyTracked !== undefined) {
    return { candidate, kind: "already-registered", slug: alreadyTracked.slug };
  }
  const slug = deriveRegisterSlug({ address, intakeId: undefined, title: candidate.title });
  const collision = bySlug.get(slug);
  return collision !== undefined
    ? { candidate, conflicting: collision.address, kind: "slug-conflict", slug }
    : { address, candidate, kind: "new", slug };
}

/**
 * Register one new candidate and report the outcome; a write failure is reported and does not stop the batch.
 *
 * @returns whether the entry was written, so the caller counts it as tracked for the rest of the batch
 */
function registerNew({
  deps,
  home,
  outcome,
}: {
  deps: ProposalSyncDeps;
  home: string;
  outcome: Extract<CandidateOutcome, { kind: "new" }>;
}): boolean {
  const appended = appendRegisterEvent({
    event: {
      address: outcome.address,
      atIso: deps.now().toISOString(),
      kind: "created",
      source: "sync",
      title: outcome.candidate.title,
    },
    home,
    slug: outcome.slug,
  });
  deps.out(
    appended.isErr()
      ? `could not register "${outcome.candidate.title}" (${outcome.candidate.pageId}): ${appended.error.message}`
      : `+ ${outcome.slug}  ${outcome.candidate.title}`,
  );
  return appended.isOk();
}

/** Discover and register one source page's direct child pages; report per-candidate and return whether the read itself succeeded. */
async function syncOneSource({
  address,
  deps,
  home,
  limit,
}: {
  address: string;
  deps: ProposalSyncDeps;
  home: string;
  limit: number;
}): Promise<boolean> {
  const read = await deps.readSourceBlocks({ address, home, limit });
  if (read.isErr()) {
    deps.err(`${address}: ${read.error.message}`);
    return false;
  }
  const candidates = childPagesOf({ results: read.value.results });
  deps.out(`${address}: ${String(candidates.length)} child page(s) found`);
  const byAddress = registeredByAddress({ home });
  const bySlug = new Map([...byAddress.values()].map((entry) => [entry.slug, entry] as const));
  // Both maps take each registration as it lands, so a page listed twice in one response (in either UUID
  // spelling) is recognised the second time rather than registered again under another slug.
  for (const candidate of candidates) {
    const outcome = resolveCandidate({ byAddress, bySlug, candidate });
    if (outcome.kind === "already-registered") {
      deps.out(`= ${outcome.slug}  ${outcome.candidate.title} (already registered)`);
    } else if (outcome.kind === "slug-conflict") {
      deps.err(
        `! "${outcome.candidate.title}" (${outcome.candidate.pageId}) derives slug "${outcome.slug}", already used ` +
          `by ${addressLabel({ address: outcome.conflicting })} — skipped; resolve by hand`,
      );
    } else if (registerNew({ deps, home, outcome })) {
      const tracked: Tracked = { address: outcome.address, slug: outcome.slug };
      byAddress.set(addressIdentityKey({ address: outcome.address }), tracked);
      bySlug.set(outcome.slug, tracked);
    }
  }
  if (read.value.hasMore) {
    deps.err(
      `${address}: this page has more top-level blocks than --limit ${String(limit)} covered — re-run with a higher --limit to see the rest`,
    );
  }
  return true;
}

/**
 * Run `proposal sync`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runProposalSync({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalSyncDeps;
}): Promise<number> {
  const parsed = parseProposalSyncArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  let anyFailed = false;
  // Sequential, deliberately: `registeredByAddress` is re-scanned per source, so one source's register writes
  // must land before the next source's scan can see them and avoid re-registering the same page twice.
  for (const address of args.sources) {
    const succeeded = await syncOneSource({ address, deps, home, limit: args.limit });
    anyFailed = anyFailed || !succeeded;
  }
  deps.err(
    "discovery only: sync never sets a status, decision, successor, audience or Slack link — classify each " +
      "new entry with `proposal status`/`decide`/`supersede`/`record-slack`/`follow-up`.",
  );
  return anyFailed ? EXIT_ERROR : EXIT_OK;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionProposalSyncDeps(): ProposalSyncDeps {
  return {
    err: (line) => process.stderr.write(`proposal: ${line}\n`),
    now: () => new Date(),
    out: (line) => {
      logger.out({ line });
    },
    readSourceBlocks: async ({ address, home, limit }) => {
      const token = notionToken({ home });
      if (token === undefined) {
        return err(
          NotionLiveErrors.readFailed({ message: "no Notion token configured; run `slopweaver connect notion`" }),
        );
      }
      const target = parseNotionReadAddress({ address, kind: "page" });
      if (target.isErr()) {
        return err(target.error);
      }
      const page = await makeNotionNamedReadApi({ token }).listBlockChildren({
        after: undefined,
        id: target.value.id,
        limit,
      });
      // `listBlockChildren` reports the boundary's own `IngestError`; mapped into this domain's typed error at
      // the point it is consumed, carrying it as the cause — see `NotionLiveErrors.readFailed`'s own callers in
      // `../../../live/notion/read.ts`.
      return page.isErr()
        ? err(NotionLiveErrors.readFailed({ cause: page.error, message: page.error.message }))
        : ok(page.value);
    },
  };
}

/** `slopweaver proposal sync` — discover a source page's direct child pages and register any not yet tracked. */
export const proposalSyncCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalSync({ argv, deps: productionProposalSyncDeps() }),
});
