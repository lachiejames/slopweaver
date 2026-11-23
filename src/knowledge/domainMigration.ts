/**
 * The plan that folds every stored recording still under a retired domain onto its canonical one — the pure
 * half of `slopweaver knowledge domains --migrate`. No I/O, no clock.
 *
 * ## Why a domain change is an id change
 *
 * A claim's id is a hash of its domain and its normalised claim (`./memoryRow.ts`'s `memoryId`), so moving a
 * recording from `github-ci` to `ci` without rewriting its id would leave a row whose id no fresh write of the
 * same claim can ever reproduce: the next `knowledge record --domain ci` of it would start a second series.
 * The plan therefore maps each OLD claim id to the id its canonical domain derives, once per claim, and
 * rewrites every column that holds a claim id — the recording's own `id`, every `supersedes` naming it, and
 * `memory_recalls.memory_id` — so the accounting and the retirements follow the claim.
 *
 * Two old claims can map to ONE new id: the same lesson filed under `ci` and under `github-ci` is exactly the
 * split this exists to close, and after the fold their recordings are one series. The plan counts those
 * merges rather than hiding them.
 *
 * ## Why one unmapped domain refuses the whole apply
 *
 * A slug that is neither canonical nor an alias is listed in {@link DomainMigrationPlan.unmapped}. The verb
 * prints the plan regardless and refuses `--apply` while the list is non-empty: a half-folded register would
 * need a second migration that could no longer tell which rows it had already moved.
 */
import { domainStanding, type InstallKnowledgeDomains } from "./domainVocabulary.js";
import type { MemoryKind } from "./memory.js";
import { memoryId } from "./memoryRow.js";

/** The columns of one stored recording the plan reads. */
export interface MigratableRecording {
  readonly recordingId: string;
  readonly id: string;
  readonly kind: MemoryKind;
  readonly domain: string;
  readonly claim: string;
  readonly supersedes: string | null;
}

/**
 * One recording's rewrite. `supersedes` is written as given, so an unchanged one is carried through.
 *
 * @internal
 */
export interface RecordingRewrite {
  readonly recordingId: string;
  readonly domain: string;
  readonly id: string;
  readonly supersedes: string | null;
}

/** What the fold would do. */
export interface DomainMigrationPlan {
  /** Every recording whose domain, id or `supersedes` changes. */
  readonly rewrites: readonly RecordingRewrite[];
  /** Every claim id that changes, old to new — what `memory_recalls.memory_id` is rewritten by. */
  readonly idMap: readonly { readonly from: string; readonly to: string }[];
  /** Per retired domain, where it goes and how many recordings move — alphabetical by `from`. */
  readonly folds: readonly { readonly from: string; readonly to: string; readonly recordings: number }[];
  /** How many old claims landed on an id another claim already carried. */
  readonly merges: number;
  /** Every stored domain neither canonical nor an alias, alphabetical — non-empty refuses an apply. */
  readonly unmapped: readonly string[];
}

/**
 * The fold, planned over every stored recording.
 *
 * @param rows every recording the table holds, in recorded order — the latest recording of a claim is the one
 * whose claim text derives its new id
 * @param installDomains this install's own domains and aliases — an install alias folds exactly like a
 * committed one
 * @returns the plan; an empty `rewrites` means the register is already canonical
 */
export function planDomainMigration({
  rows,
  installDomains,
}: {
  rows: readonly MigratableRecording[];
  installDomains: InstallKnowledgeDomains;
}): DomainMigrationPlan {
  const { canonicalOf, idMap, merges, unmapped } = mapClaims({ installDomains, rows });
  const folded = new Map<string, number>();
  const rewrites: RecordingRewrite[] = [];
  rows.forEach((row) => {
    const canonical = canonicalOf.get(row.domain);
    const movedId = idMap.get(row.id);
    const movedTarget = row.supersedes === null ? undefined : idMap.get(row.supersedes);
    if (canonical === undefined && movedTarget === undefined) {
      return;
    }
    // Each column keeps its stored value unless the plan moved it — spelled as ifs, one per column.
    let domain = row.domain;
    if (canonical !== undefined) {
      const sofar = folded.get(row.domain);
      folded.set(row.domain, sofar === undefined ? 1 : sofar + 1);
      domain = canonical;
    }
    let id = row.id;
    if (movedId !== undefined) {
      id = movedId;
    }
    let target = row.supersedes;
    if (movedTarget !== undefined) {
      target = movedTarget;
    }
    // A claim re-filed under its canonical domain with `--supersedes` naming the alias spelling MERGES with
    // it here, and a recording naming its own claim is what every writer refuses (`./row.ts`'s
    // `requireSupersedes`) — so the retirement the merge made moot is dropped rather than kept pointing inward.
    rewrites.push({ domain, id, recordingId: row.recordingId, supersedes: target === id ? null : target });
  });
  return {
    folds: [...folded.entries()]
      .map(([from, recordings]) => ({ from, recordings, to: canonicalOf.get(from)! }))
      .toSorted((left, right) => left.from.localeCompare(right.from)),
    idMap: [...idMap.entries()].map(([from, to]) => ({ from, to })),
    merges,
    rewrites,
    unmapped: [...unmapped].toSorted(),
  };
}

/**
 * Where each CLAIM goes, decided once from its latest recording: every retired domain's canonical home, every
 * moved claim's new id, how many of those landed on an id already taken, and which domains map nowhere.
 */
function mapClaims({
  rows,
  installDomains,
}: {
  rows: readonly MigratableRecording[];
  installDomains: InstallKnowledgeDomains;
}): {
  canonicalOf: ReadonlyMap<string, string>;
  idMap: ReadonlyMap<string, string>;
  merges: number;
  unmapped: ReadonlySet<string>;
} {
  const latest = new Map<string, MigratableRecording>();
  rows.forEach((row) => {
    latest.set(row.id, row);
  });
  const unmapped = new Set<string>();
  const canonicalOf = new Map<string, string>();
  const idMap = new Map<string, string>();
  const newIdsOfUnmoved = new Set<string>();
  latest.forEach((row, id) => {
    const standing = domainStanding({ domain: row.domain, installDomains });
    if (standing.kind === "unknown") {
      unmapped.add(row.domain);
      return;
    }
    if (standing.kind === "canonical") {
      newIdsOfUnmoved.add(id);
      return;
    }
    canonicalOf.set(row.domain, standing.canonical);
    idMap.set(id, memoryId({ claim: row.claim, domain: standing.canonical, kind: row.kind }));
  });
  const landed = new Set(newIdsOfUnmoved);
  let merges = 0;
  idMap.forEach((to) => {
    if (landed.has(to)) {
      merges += 1;
    }
    landed.add(to);
  });
  return { canonicalOf, idMap, merges, unmapped };
}
