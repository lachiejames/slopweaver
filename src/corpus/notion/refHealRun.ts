/**
 * Heal carved content refs in Notion bronze — the effectful half: find the damaged winners, read the stores,
 * append the healed versions through the one bronze write path, and prove the latest view moved.
 *
 * The pure decisions are `refHeal.ts`. What lives here is only what touches disk:
 *
 * - **Two streamed passes, never a whole-file read.** Notion bronze is hundreds of MB. Pass one parses only
 *   lines carrying both `sha256:` and `[number]` to name the damaged identities; pass two keeps every
 *   version of those identities and nothing else, so the winner rule sees every competitor.
 * - **Only a WINNER is healed.** A superseded damaged row is already hidden by `latestRecords`, and appending
 *   a healed copy of it would resurrect nothing but noise. MEASURED: 41 of the 50 identities
 *   that ever carried a carved ref were already superseded.
 * - **Appended, never rewritten in place.** Bronze is append-only; the healed row has the same `tsIso` and
 *   text and a strictly longer serialisation (an intact digest is longer than `[number]` by at least one
 *   character per carved run), so `latestRecords`' tie-break selects it. That claim is not trusted — the
 *   census is re-run after the write, and every identity still damaged is reported by id.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import {
  type CorpusJudge,
  corpusJudgeFor,
  type OwnerProtectionResolver,
  protectionResolver,
} from "../bronzeProtection.js";
import { listBronzeFiles } from "../bronzeStorage.js";
import { parseRow } from "../corpusRowCore.js";
import { readJsonlLines } from "../corpusStore.js";
import { writeCorpusRecords } from "../corpusWriter.js";
import { latestRecords, recordIdentity } from "../latestRecords.js";
import type { CorpusRecord } from "../types.js";
import { attachmentRoot } from "./attachmentStore.js";
import { bodyRoot } from "./bodyStore.js";
import { canonicalNotionRecord, notionSourceIdSpellings } from "./canonicalId.js";
import { carriesMangledRef, healRecordRefs, type RecordHeal, type RefHealStore, type RefKind } from "./refHeal.js";

/** What the census found. */
export interface RefHealCensus {
  /** Identities with at least one version carrying a carved ref. */
  readonly damagedIdentities: number;
  /** Of those, how many are already superseded by an intact winner. */
  readonly superseded: number;
  /** The damaged winners, each with its proposed heal. */
  readonly targets: readonly { readonly sourceId: string; readonly tsIso: string; readonly heal: RecordHeal }[];
}

/** What an applied heal wrote, and what the re-run census still found damaged. */
export interface RefHealApplied {
  readonly written: number;
  readonly stillDamaged: readonly string[];
}

/**
 * Every digest stored under one content-store root, each shard directory judged as a search BEFORE it is listed and
 * each digest as a read before it is named, so a symlink inside the store cannot carry a later hash into a protected
 * tree. The root itself is judged by the caller. Only a digest filed under its own two-character shard is named,
 * because that is the one path {@link homeRefHealStore}'s `inspect` opens, so it can open nothing the judge skipped.
 *
 * @returns the digests, or the first refusal
 */
function judgedDigests({ root, judge }: { root: string; judge: CorpusJudge }): Result<readonly string[]> {
  if (!existsSync(root)) {
    return ok([]);
  }
  let digests: readonly string[] = [];
  for (const shard of readdirSync(root, { withFileTypes: true })) {
    if (!shard.isDirectory()) {
      continue;
    }
    const found = shardDigests({ dir: join(root, shard.name), judge, shard: shard.name });
    if (found.isErr()) {
      return err(found.error);
    }
    digests = digests.concat(found.value);
  }
  return ok(digests);
}

/**
 * The digests one shard directory holds under its own two-character prefix: the directory judged as a search before
 * it is listed, each digest as a read before it is named.
 *
 * @param dir the shard directory
 * @param shard its name, the prefix a digest filed in it must carry
 * @param judge the operation's judge
 * @returns the shard's digests, or the first refusal
 */
function shardDigests({
  dir,
  shard,
  judge,
}: {
  dir: string;
  shard: string;
  judge: CorpusJudge;
}): Result<readonly string[]> {
  const searched = judge({ access: "search", path: dir });
  if (searched.isErr()) {
    return err(searched.error);
  }
  const digests: string[] = [];
  for (const digest of readdirSync(dir)) {
    if (digest.slice(0, 2) !== shard) {
      continue;
    }
    const read = judge({ access: "read", path: join(dir, digest) });
    if (read.isErr()) {
      return err(read.error);
    }
    digests.push(digest);
  }
  return ok(digests);
}

/**
 * The store seams over a real home's already-judged digests: a file hashed only when it is the single candidate for a
 * carved digest. The core inspects only a digest `held` named, so every path hashed here is one the judge cleared.
 *
 * @param roots each kind's content-store root
 * @param held each kind's judged digests
 * @returns the seams the pure core reads through
 */
function homeRefHealStore({
  roots,
  held,
}: {
  roots: Readonly<Record<RefKind, string>>;
  held: Readonly<Record<RefKind, readonly string[]>>;
}): RefHealStore {
  return {
    held: ({ kind }) => held[kind],
    inspect: ({ kind, digest }) => {
      const path = join(roots[kind], digest.slice(0, 2), digest);
      return { sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), size: statSync(path).size };
    },
  };
}

/**
 * Pass one: the identities any version of which carries a carved ref, and the serialised `sourceId` field
 * each carries — the needle pass two's line pre-filter looks for before paying for a parse.
 */
function damagedIdentities({ paths }: { paths: readonly string[] }): {
  readonly identities: ReadonlySet<string>;
  readonly needles: ReadonlySet<string>;
} {
  const identities = new Set<string>();
  const needles = new Set<string>();
  for (const path of paths) {
    readJsonlLines({
      onLine: ({ line }) => {
        if (!line.includes("sha256:") || !line.includes("[number]")) {
          return;
        }
        const parsed = parseRow({ line });
        if ("record" in parsed && carriesMangledRef({ record: parsed.record })) {
          // Keyed on the canonical id the writer appends a heal under, and searched for under BOTH spellings
          // whichever one this row has: an uncompacted version under the other is the same identity, and
          // pass two must see every competitor for the winner rule to hold.
          const record = canonicalNotionRecord({ record: parsed.record });
          identities.add(recordIdentity({ record }));
          for (const spelling of notionSourceIdSpellings({ sourceId: record.sourceId })) {
            needles.add(`"sourceId":${JSON.stringify(spelling)}`);
          }
        }
      },
      path,
    });
  }
  return { identities, needles };
}

/** Pass two: every version of the damaged identities, in bronze read order. */
function versionsOf({
  paths,
  identities,
  needles,
}: {
  paths: readonly string[];
  identities: ReadonlySet<string>;
  needles: ReadonlySet<string>;
}): readonly CorpusRecord[] {
  const versions: CorpusRecord[] = [];
  const needleList = [...needles];
  for (const path of paths) {
    readJsonlLines({
      onLine: ({ line }) => {
        if (!needleList.some((needle) => line.includes(needle))) {
          return;
        }
        const parsed = parseRow({ line });
        if (!("record" in parsed)) {
          return;
        }
        const record = canonicalNotionRecord({ record: parsed.record });
        if (identities.has(recordIdentity({ record }))) {
          versions.push(record);
        }
      },
      path,
    });
  }
  return versions;
}

/**
 * The real home's store seams, once the owner's protect list clears both content-store roots and everything under
 * them the seams would list or hash: each root and shard directory as a SEARCH, each digest as a READ. Judging the
 * root alone was not enough, because a symlink inside the store resolves somewhere the root's judgement never saw.
 *
 * @param home the state home the corpus lives under
 * @param protection an injected resolver, or `undefined` for both of the owner's registries
 * @returns the seams, or the refusal
 */
function judgedHomeStore({
  home,
  protection,
}: {
  home: string;
  protection: OwnerProtectionResolver | undefined;
}): Result<RefHealStore> {
  const judge = corpusJudgeFor({
    operation: { target: "the Notion content stores", verb: "read" },
    protection: protectionResolver({ home, protection }),
  });
  if (judge.isErr()) {
    return err(judge.error);
  }
  const roots: Record<RefKind, string> = { attachment: attachmentRoot({ home }), body: bodyRoot({ home }) };
  const held: Record<RefKind, readonly string[]> = { attachment: [], body: [] };
  for (const kind of ["attachment", "body"] as const) {
    const root = judge.value({ access: "search", path: roots[kind] });
    if (root.isErr()) {
      return err(root.error);
    }
    const digests = judgedDigests({ judge: judge.value, root: roots[kind] });
    if (digests.isErr()) {
      return err(digests.error);
    }
    held[kind] = digests.value;
  }
  return ok(homeRefHealStore({ held, roots }));
}

/**
 * Find every Notion latest-view winner carrying a carved content ref, and what healing each would do.
 * Reads bronze and the content stores, each judged by the owner's protect list first; writes nothing.
 *
 * @param home the state home the corpus lives under
 * @param store the store seams — the real home's, judged, unless a test injects its own
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the census, or the refusal naming what the protect list covers
 */
export function censusRefHeal({
  home,
  store,
  protection,
}: {
  home: string;
  store?: RefHealStore;
  protection?: OwnerProtectionResolver | undefined;
}): Result<RefHealCensus> {
  const listed = listBronzeFiles({ home, protection, source: "notion" });
  if (listed.isErr()) {
    return err([listed.error.message]);
  }
  const seams = store === undefined ? judgedHomeStore({ home, protection }) : ok(store);
  if (seams.isErr()) {
    return err(seams.error);
  }
  const paths = listed.value.map((file) => file.path);
  const { identities, needles } = damagedIdentities({ paths });
  if (identities.size === 0) {
    return ok({ damagedIdentities: 0, superseded: 0, targets: [] });
  }
  const versions = versionsOf({ identities, needles, paths });
  const winners = latestRecords({ records: versions }).filter((record) => carriesMangledRef({ record }));
  return ok({
    damagedIdentities: identities.size,
    superseded: identities.size - winners.length,
    targets: winners.map((record) => ({
      heal: healRecordRefs({ record, store: seams.value }),
      sourceId: record.sourceId,
      tsIso: record.tsIso,
    })),
  });
}

/**
 * Append every healed target through the one bronze write path, then re-run the census and name each
 * identity whose winner still carries a carved ref.
 *
 * @param home the state home the corpus lives under
 * @param census the census the operator reviewed — only its targets that healed at least one ref are written
 * @param store the store seams — the real home's, judged, unless a test injects its own
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns how many rows reached disk and what is still damaged afterwards, or the write's or re-census's refusal
 */
export function applyRefHeal({
  home,
  census,
  store,
  protection,
}: {
  home: string;
  census: RefHealCensus;
  store?: RefHealStore;
  protection?: OwnerProtectionResolver | undefined;
}): Result<RefHealApplied> {
  const healed = census.targets.filter((target) => target.heal.healed > 0).map((target) => target.heal.record);
  if (healed.length === 0) {
    return ok({ stillDamaged: census.targets.map((target) => target.sourceId), written: 0 });
  }
  const instants = healed.map((record) => record.tsIso).toSorted();
  const window = { since: instants[0]!, until: instants[instants.length - 1]! };
  const written = writeCorpusRecords({
    home,
    records: healed,
    window,
    ...(protection !== undefined ? { protection } : {}),
  });
  if (written.isErr()) {
    return err(written.error);
  }
  const after = censusRefHeal({ home, protection, ...(store !== undefined ? { store } : {}) });
  return after.map((recensus) => ({
    stillDamaged: recensus.targets.map((target) => target.sourceId),
    written: written.value.written,
  }));
}
