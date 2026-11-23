/**
 * Whether every row an import would write has what it needs: a recall needs the recording it counts, of the claim it
 * names, and a memory that supersedes a claim needs that claim recorded under its own kind and no other — each held
 * live or written by the same import. The knowledge register refuses a write that closes over nothing
 * (`../../knowledge/restoreMerge.ts`, `closureRefusal`, and the checks the import writer makes as its transaction
 * sees the register), so a plan that left one in would read ready and then fail at the write. A memory never
 * supersedes its own claim, as the register's restore holds it. A row the plan keeps out — an alignment's imported memory above all — provides nothing, so a new recall
 * of it is unmet here rather than discovered there. Pure.
 *
 * A need and a provision are the same STRUCTURED value, compared by a canonical tuple of its fields, never by its
 * sentence: identifiers are any string a decoder admits, so a sentence joining two of them is not injective (Codex
 * p3, 5-2 closure). The sentence is only what a person reads about one that is unmet.
 */
import type { StoreExportPartKind } from "./parts.js";
import type { RetainedEntry } from "./retained.js";

/** One thing a row provides or needs. */
export type Dependency =
  /** That recording, belonging to that claim — what a recall counts. */
  | { readonly link: "recording"; readonly recordingId: string; readonly claimId: string }
  /** That claim, recorded under that kind — what a superseding recording of the same kind names. */
  | { readonly link: "claim-kind"; readonly claimId: string; readonly kind: string }
  /** A claim other than this one — what a recording superseding its own claim needs, and nothing provides. */
  | { readonly link: "another-claim"; readonly claimId: string };

/** One written row whose need nothing live or written provides. */
export interface UnmetDependency {
  readonly part: StoreExportPartKind;
  readonly key: string;
  /** What it needs, as a person reads it. */
  readonly needs: string;
}

/**
 * What a recording provides and a recall needs: that recording, of that claim.
 *
 * @returns the dependency
 */
export function recordingOfClaim({ recordingId, claimId }: { recordingId: string; claimId: string }): Dependency {
  return { claimId, link: "recording", recordingId };
}

/**
 * What a recording provides and a superseding one needs: that claim, recorded under that kind.
 *
 * @returns the dependency
 */
export function claimOfKind({ claimId, kind }: { claimId: string; kind: string }): Dependency {
  return { claimId, kind, link: "claim-kind" };
}

/**
 * What a memory superseding its own claim needs, which no row provides: the register refuses that link whatever else
 * records the claim, so it is always unmet.
 *
 * @returns the dependency, provided by nothing
 */
export function anotherClaimThan({ claimId }: { claimId: string }): Dependency {
  return { claimId, link: "another-claim" };
}

/** A dependency's identity: a canonical tuple of its link and fields, injective whatever the fields hold. */
function identity({ dependency }: { dependency: Dependency }): string {
  switch (dependency.link) {
    case "recording": {
      return JSON.stringify([dependency.link, dependency.recordingId, dependency.claimId]);
    }
    case "claim-kind": {
      return JSON.stringify([dependency.link, dependency.claimId, dependency.kind]);
    }
    case "another-claim": {
      return JSON.stringify([dependency.link, dependency.claimId]);
    }
    default: {
      const unreachable: never = dependency;
      return unreachable;
    }
  }
}

/** A dependency as a person reads it. */
function describeDependency({ dependency }: { dependency: Dependency }): string {
  switch (dependency.link) {
    case "recording": {
      return `recording ${dependency.recordingId} of claim ${dependency.claimId}`;
    }
    case "claim-kind": {
      return `claim ${dependency.claimId} recorded as a ${dependency.kind}, and as nothing else`;
    }
    case "another-claim": {
      return `a claim other than ${dependency.claimId} itself to supersede`;
    }
    default: {
      const unreachable: never = dependency;
      return unreachable;
    }
  }
}

/** A row's dependency list, where a row that declares none has none by design. */
function listedIn({ list }: { list: readonly Dependency[] | undefined }): readonly Dependency[] {
  if (list === undefined) {
    return [];
  }
  return list;
}

/** Every row's entries, part by part. */
type PartRows = readonly (readonly [StoreExportPartKind, readonly RetainedEntry[]])[];

/** Every dependency the rows provide, by identity, and every kind each claim is recorded under. */
function providedBy({ rows }: { rows: PartRows }): {
  provided: ReadonlySet<string>;
  kindsByClaim: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const provided = new Set<string>();
  const kindsByClaim = new Map<string, Set<string>>();
  const provisions = rows.flatMap(([, entries]) => entries.flatMap((entry) => listedIn({ list: entry.provides })));
  for (const dependency of provisions) {
    provided.add(identity({ dependency }));
    if (dependency.link !== "claim-kind") {
      continue;
    }
    const kinds = kindsByClaim.get(dependency.claimId);
    if (kinds === undefined) {
      kindsByClaim.set(dependency.claimId, new Set([dependency.kind]));
    } else {
      kinds.add(dependency.kind);
    }
  }
  return { kindsByClaim, provided };
}

/**
 * Every need a written row has that no live or written row provides.
 *
 * @param live every live row, part by part
 * @param written every imported row the plan would write, part by part
 * @returns the unmet needs, in part order, then row order, then need order
 */
export function unmetDependencies({
  live,
  written,
}: {
  live: PartRows;
  written: PartRows;
}): readonly UnmetDependency[] {
  const { provided, kindsByClaim } = providedBy({ rows: [...live, ...written] });
  return written.flatMap(([part, entries]) =>
    entries.flatMap((entry) =>
      listedIn({ list: entry.requires })
        .filter((dependency) => !met({ dependency, kindsByClaim, provided }))
        .map((dependency) => ({ key: entry.key, needs: describeDependency({ dependency }), part })),
    ),
  );
}

/**
 * Whether a need is provided. A self-supersede's need is never met, whatever any row claims to provide. A claim a
 * recording supersedes must be recorded under that kind and NO other: the
 * import writer checks the claim's LATEST recording's kind (`../../knowledge/supersession.ts`), and which recording
 * is latest is the store's own order, so a claim held under two kinds is unmet whichever kind its latest carries.
 */
function met({
  dependency,
  provided,
  kindsByClaim,
}: {
  dependency: Dependency;
  provided: ReadonlySet<string>;
  kindsByClaim: ReadonlyMap<string, ReadonlySet<string>>;
}): boolean {
  if (dependency.link === "another-claim") {
    return false;
  }
  if (dependency.link === "claim-kind") {
    const kinds = kindsByClaim.get(dependency.claimId);
    return kinds?.size === 1 && kinds.has(dependency.kind);
  }
  return provided.has(identity({ dependency }));
}
