/**
 * The two denominators the `outbound-privacy-closure` gate (`./outboundPrivacyClosure.ts`) closes over, and every
 * issue raised before a single file is read: each external-write verb selected by a family, each sanctioned SDK
 * factory owned by exactly one, and each family's own row well formed. Pure: registry values in, issues out.
 */
import type { NounGroups } from "../cli/router.js";
import type { ExternalWriteSelector, OutboundWriteFamily } from "./outboundPrivacyRegistry.js";

/** Every way the closure fails; each message names the correction. */
type OutboundPrivacyClosureCode =
  | "EMPTY_DENOMINATOR"
  | "DUPLICATE_FAMILY"
  | "EMPTY_REASON"
  | "NO_ROOT"
  | "READ_ONLY_REACHES_WRITE"
  | "UNREGISTERED_EXTERNAL_WRITE"
  | "STALE_SELECTOR"
  | "UNCLASSIFIED_FACTORY"
  | "STALE_FACTORY"
  | "DUPLICATE_FACTORY"
  | "MISSING_MODULE"
  | "CHECK_NOT_CALLED"
  | "GUARD_NOT_REACHED"
  | "RESIDUE_IS_NOW_GUARDED"
  | "PARTIAL_FAMILY";

/** One closure failure. */
export interface OutboundPrivacyClosureIssue {
  readonly code: OutboundPrivacyClosureCode;
  readonly subject: string;
  readonly message: string;
}

/**
 * Every non-alias external-write verb, as `noun verb`.
 *
 * @param groups the folded verb registry
 * @returns each external-write verb, sorted
 */
export function externalWriteVerbsOf({ groups }: { groups: NounGroups }): readonly string[] {
  const rows: string[] = [];
  // Own property names, not `Object.entries`: the router resolves a verb by direct lookup, so a non-enumerable
  // one would dispatch while staying invisible to an enumeration.
  for (const noun of Object.getOwnPropertyNames(groups)) {
    const verbs = groups[noun]!;
    for (const verb of Object.getOwnPropertyNames(verbs)) {
      if (verb !== "" && verbs[verb]!.meta.effect === "external-write") {
        rows.push(`${noun} ${verb}`);
      }
    }
  }
  return rows.toSorted();
}

/** Whether a selector covers one `noun verb`. */
function selects({ selector, row }: { selector: ExternalWriteSelector; row: string }): boolean {
  const [noun, verb] = row.split(" ");
  if (noun !== selector.noun || verb === undefined) {
    return false;
  }
  return selector.verbs === "all" || selector.verbs.includes(verb);
}

/** What a selector names that selects no external-write verb: each dead named verb, or a whole noun writing none. */
function staleNamesOf({
  selector,
  externalWrites,
}: {
  selector: ExternalWriteSelector;
  externalWrites: readonly string[];
}): readonly string[] {
  if (selector.verbs === "all") {
    return externalWrites.some((row) => row.startsWith(`${selector.noun} `)) ? [] : [selector.noun];
  }
  return selector.verbs.map((verb) => `${selector.noun} ${verb}`).filter((named) => !externalWrites.includes(named));
}

/**
 * The issues the verb denominator raises: an external-write verb no family selects, or a selector naming none.
 *
 * @param families the registry
 * @param externalWrites every external-write verb, as `noun verb`
 * @returns one issue per unselected verb and per stale selector name
 */
export function verbIssues({
  families,
  externalWrites,
}: {
  families: readonly OutboundWriteFamily[];
  externalWrites: readonly string[];
}): readonly OutboundPrivacyClosureIssue[] {
  const unselected = externalWrites
    .filter((row) => !families.some((family) => family.selectors.some((selector) => selects({ row, selector }))))
    .map((row) => ({
      code: "UNREGISTERED_EXTERNAL_WRITE" as const,
      message: `\`${row}\` writes outside this machine and no family selects it: wire its transport through checkPrivacy and add it to a guarded family, or name it as residue with its reason`,
      subject: row,
    }));
  const stale = families.flatMap((family) =>
    family.selectors.flatMap((selector) =>
      staleNamesOf({ externalWrites, selector }).map((named) => {
        const subject = `${family.id}: ${named}`;
        return {
          code: "STALE_SELECTOR" as const,
          message: `${subject} selects no external-write verb: drop the selector`,
          subject,
        };
      }),
    ),
  );
  return [...unselected, ...stale];
}

/** Which families own each factory they name, in registry order. */
function ownersOf({ families }: { families: readonly OutboundWriteFamily[] }): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, readonly string[]>();
  for (const family of families) {
    for (const factory of family.factories) {
      const prior = owners.get(factory);
      owners.set(factory, prior === undefined ? [family.id] : [...prior, family.id]);
    }
  }
  return owners;
}

/** The issue one sanctioned factory's owners raise: none, or more than one. */
function ownershipIssues({
  factory,
  owning,
}: {
  factory: string;
  owning: readonly string[] | undefined;
}): readonly OutboundPrivacyClosureIssue[] {
  if (owning === undefined) {
    return [
      {
        code: "UNCLASSIFIED_FACTORY",
        message: `${factory} builds an SDK client and no family owns it: add it to its provider's family, guarded, read-only or residue`,
        subject: factory,
      },
    ];
  }
  if (owning.length > 1) {
    return [
      {
        code: "DUPLICATE_FACTORY",
        message: `${factory} is owned by ${owning.join(" and ")}: one family owns each factory`,
        subject: factory,
      },
    ];
  }
  return [];
}

/**
 * The issues the factory inventory raises: an unowned factory, an owned one no longer sanctioned, one owned twice.
 *
 * @param families the registry
 * @param sanctioned the keys of `SANCTIONED_CLIENT_FACTORIES`
 * @returns one issue per stale, unowned or doubly owned factory
 */
export function factoryIssues({
  families,
  sanctioned,
}: {
  families: readonly OutboundWriteFamily[];
  sanctioned: readonly string[];
}): readonly OutboundPrivacyClosureIssue[] {
  const stale = families.flatMap((family) =>
    family.factories
      .filter((factory) => !sanctioned.includes(factory))
      .map((factory) => ({
        code: "STALE_FACTORY" as const,
        message: `${family.id}: ${factory} is not in SANCTIONED_CLIENT_FACTORIES: drop it from the family`,
        subject: `${family.id}: ${factory}`,
      })),
  );
  const owners = ownersOf({ families });
  return [...stale, ...sanctioned.flatMap((factory) => ownershipIssues({ factory, owning: owners.get(factory) }))];
}

/**
 * The issues a family's own shape raises, before any file is read: a duplicated id, an unstated reason, a family
 * with nothing to check, and a read-only family that names a write.
 *
 * @param families the registry
 * @returns one issue per malformed row
 */
export function shapeIssues({
  families,
}: {
  families: readonly OutboundWriteFamily[];
}): readonly OutboundPrivacyClosureIssue[] {
  const issues: OutboundPrivacyClosureIssue[] = [];
  const ids = families.map(({ id }) => id);
  for (const id of new Set(ids.filter((candidate, index) => ids.indexOf(candidate) !== index))) {
    issues.push({ code: "DUPLICATE_FAMILY", message: `${id} is declared twice: one row per family`, subject: id });
  }
  for (const family of families) {
    const { classification } = family;
    if (classification.kind !== "guarded" && classification.reason.trim() === "") {
      issues.push({
        code: "EMPTY_REASON",
        message: `${family.id}: a ${classification.kind} family states its reason`,
        subject: family.id,
      });
    }
    if (classification.kind !== "read-only" && family.transports.length === 0 && family.factories.length === 0) {
      issues.push({
        code: "NO_ROOT",
        message: `${family.id}: a ${classification.kind} family names at least one transport or factory, or nothing is checked`,
        subject: family.id,
      });
    }
    if (classification.kind === "read-only" && (family.selectors.length > 0 || family.transports.length > 0)) {
      issues.push({
        code: "READ_ONLY_REACHES_WRITE",
        message: `${family.id}: a read-only family selects no write verb and names no write transport: classify it guarded or residue`,
        subject: family.id,
      });
    }
  }
  return issues;
}
