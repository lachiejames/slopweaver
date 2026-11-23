/**
 * Reading a target's demand off its descriptor, the profile and the corpus store — the effectful shell around
 * `./demand.ts`'s pure judgement.
 *
 * BOUNDED, on its own connection, for the reason `../../store/newest.ts` gives: this runs inside a scheduled
 * session's slot, and `connectStore` sets no `connect_timeout`, so a stopped database would hang it for the OS
 * default. One connection serves every term and source.
 *
 * Every failure is `unreadable` and never a guess either way: walking on a store that did not answer re-creates
 * the sign-in ask the gate exists to end, and reading it as no demand would silence a real one. The verb answers
 * `unreadable` with `EXIT_DEFERRED`, so the slot stays due and the next pass asks again.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { findAtlasPlatform } from "../../atlas/registry.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { readProfile } from "../../profileStore.js";
import type { StoreReader } from "../../store/client.js";
import { storeUrlSelection } from "../../store/config.js";
import { runHits } from "../../store/probe/hits.js";
import * as storeSchema from "../../store/schema.js";
import {
  demandPagingDone,
  isInstant,
  judgeResyncDemand,
  RESYNC_DEMAND_SOURCES,
  type ResyncDemandHit,
  type ResyncDemandRead,
  unusableHit,
} from "./demand.js";
import type { ResyncTarget } from "./target.js";

/**
 * How long the whole demand read may take. Twelve indexed full-text pages on this install answer well inside it:
 * `time slopweaver store hits --term aether --shape exact --source slack --json`.
 */
const DEMAND_READ_BUDGET_MS = 10_000;

/** One page of a term's newest hits in one source. */
const HITS_PER_PAGE = 20;

/**
 * How many pages one term may read back in one source before the check gives up undecided. Two hundred of the
 * fleet's own mentions in one source since the last read is past anything seen; past it the slot defers rather
 * than reading the unread remainder as nobody asking.
 */
const MAX_PAGES = 10;

/**
 * Whether anyone has given this target a reason to walk since `sinceIso`.
 *
 * @param home the state home whose profile names the fleet's own ids and whose store selection is read
 * @param target the target about to resync
 * @param sinceIso the target's last successful read, or `null` when it never read
 * @returns `ungated` for a target that declares no gate, else what the store says
 */
export async function readResyncDemand({
  home,
  target,
  sinceIso,
}: {
  readonly home: string;
  readonly target: ResyncTarget;
  readonly sinceIso: string | null;
}): Promise<ResyncDemandRead> {
  if (target.kind !== "atlas") {
    return { kind: "ungated" };
  }
  const registration = findAtlasPlatform({ platform: target.platform });
  if (registration === null) {
    return { kind: "ungated" };
  }
  const gate = (await registration.readDescriptor()).resyncDemand;
  if (gate === undefined) {
    return { kind: "ungated" };
  }
  // The state parser accepts any string here, and a boundary that is not a time would compare false against every
  // hit and read as nobody asking.
  if (!isInstant({ iso: sinceIso })) {
    return {
      kind: "unreadable",
      why: `the resync state's last success ${String(sinceIso)} is not a time, so what is newer than it cannot be told`,
    };
  }
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return {
      kind: "unreadable",
      why: `profile.json would not read, so the fleet's own posts cannot be told apart: ${profile.error.message}`,
    };
  }
  // No fleet ids is not "no fleet": the fleet's own Slack users are not provider-flagged bots, so without their
  // ids every one of its posts would read as a person's ask and walk. A missing block and an empty one are the
  // same gap, and so is a block of blank strings, which the profile schema accepts.
  const bot = profile.value?.slackBot;
  const listed = bot === undefined ? [] : [...bot.botUserIds, ...bot.selfUserIds];
  const excludedAuthorIds = listed.map((id) => id.trim()).filter((id) => id !== "");
  if (excludedAuthorIds.length === 0) {
    return {
      kind: "unreadable",
      why: "profile.json names no slackBot ids, so the fleet's own posts cannot be told apart from a person's",
    };
  }
  const hits = await searchStore({ excludedAuthorIds, home, sinceIso, terms: gate.terms });
  if (hits.kind === "unreadable") {
    return hits;
  }
  const record = judgeResyncDemand({ excludedAuthorIds, hits: hits.hits, sinceIso });
  if (record === null) {
    return { kind: "unwanted", sinceIso, terms: gate.terms };
  }
  return { kind: "wanted", record };
}

/**
 * Every term's human hits in every demand source back to `sinceIso`, on one bounded connection — paged until
 * `demandPagingDone` says no older page could change the judgement.
 */
async function searchStore({
  excludedAuthorIds,
  home,
  sinceIso,
  terms,
}: {
  readonly excludedAuthorIds: readonly string[];
  readonly home: string;
  readonly sinceIso: string | null;
  readonly terms: readonly string[];
}): Promise<
  | { readonly kind: "hits"; readonly hits: readonly ResyncDemandHit[] }
  | { readonly kind: "unreadable"; readonly why: string }
> {
  const selected = storeUrlSelection({ home });
  if (selected.isErr()) {
    return { kind: "unreadable", why: `no corpus store is selected to search: ${selected.error.message}` };
  }
  const seconds = Math.ceil(DEMAND_READ_BUDGET_MS / 1000);
  // Constructed INSIDE the guard, as `../../store/newest.ts` does: `postgres()` parses the URL synchronously and
  // throws on a malformed selection.
  let sql: postgres.Sql | undefined;
  try {
    sql = postgres(selected.value.url, {
      connection: { statement_timeout: DEMAND_READ_BUDGET_MS },
      connect_timeout: seconds,
      max: 1,
      onnotice: () => {},
      prepare: false,
    });
    // Every page reads ONE snapshot: offset paging across separate statements would skip a row whenever a store
    // write removed one ahead of it between two pages.
    return await drizzle(sql, { schema: storeSchema }).transaction(
      async (tx) => {
        const reader: StoreReader = { db: tx };
        const hits: ResyncDemandHit[] = [];
        for (const term of terms) {
          for (const source of RESYNC_DEMAND_SOURCES) {
            const read = await pageBack({ excludedAuthorIds, reader, sinceIso, source, term });
            if (read.kind === "unreadable") {
              return read;
            }
            hits.push(...read.hits);
          }
        }
        return { hits, kind: "hits" } as const;
      },
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
  } catch (cause) {
    return { kind: "unreadable", why: `the corpus store did not answer: ${errorMessage({ error: cause })}` };
  } finally {
    if (sql !== undefined) {
      await sql.end({ timeout: seconds });
    }
  }
}

/** One term's hits in one source, newest first, paged back until no older page could change the judgement. */
async function pageBack({
  excludedAuthorIds,
  reader,
  sinceIso,
  source,
  term,
}: {
  readonly excludedAuthorIds: readonly string[];
  readonly reader: StoreReader;
  readonly sinceIso: string | null;
  readonly source: string;
  readonly term: string;
}): Promise<
  | { readonly kind: "hits"; readonly hits: readonly ResyncDemandHit[] }
  | { readonly kind: "unreadable"; readonly why: string }
> {
  const hits: ResyncDemandHit[] = [];
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const page = await runHits({
      includeBots: false,
      limit: HITS_PER_PAGE,
      offset: pageIndex * HITS_PER_PAGE,
      reader,
      shape: "exact",
      source,
      term,
    });
    if (page.isErr()) {
      return {
        kind: "unreadable",
        why: `the corpus store would not search ${source} for ${term}: ${page.error.message}`,
      };
    }
    const unusable = unusableHit({ hits: page.value });
    if (unusable !== null) {
      return { kind: "unreadable", why: unusable };
    }
    hits.push(...page.value);
    if (demandPagingDone({ excludedAuthorIds, page: page.value, pageSize: HITS_PER_PAGE, sinceIso })) {
      return { hits, kind: "hits" };
    }
  }
  return {
    kind: "unreadable",
    why: `${String(MAX_PAGES * HITS_PER_PAGE)} ${source} records naming ${term} since the last read, none a person's, hid anything older, so nothing was decided`,
  };
}
