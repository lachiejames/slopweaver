/**
 * The gaps one operation kind carries after a successful read, and — just as important — the rechecks that
 * let them CLOSE.
 *
 * ## Why the rechecks are the substance of this module
 *
 * The kit's lifecycle accumulates and closes a gap only when its own `(condition, scope)` pair is genuinely
 * rechecked, which is the owner's "accumulate, never replace". That rule cuts both ways: a run that raises a
 * disagreement and does not also declare what it rechecked can never close one, so the day Braze ships the 55
 * missing operations in its collection the atlas would still report them missing forever.
 *
 * Every condition here is decided by looking at BOTH published sources on every run, so every one of them is
 * genuinely rechecked and every scope this run examined is declared resolved unless it fired. The two
 * credential gaps are the exception and are deliberately never rechecked to `resolved`: only a credential
 * closes them, and no reading of a public document is evidence about one.
 */
import type { BrazeCollectionOperationRow } from "./collection.js";
import type { BrazeDocsOperationRow } from "./docsCatalogue.js";
import { type BrazeGapRecheck, openBrazeGap } from "./gaps.js";
import type { BrazeAtlasGap, BrazeKind } from "./model.js";

/**
 * One address a published source spells in a form that does not resolve. Only the two published channels
 * read addresses, and only their rows are rechecked, so a malformed address can only name one of them.
 */
export interface BrazeMalformedAddress {
  readonly channel: "docs" | "collection";
  readonly detail: string;
  readonly providerId: string;
}

/**
 * What this run saw for one kind, which is everything the gaps and their rechecks are derived from.
 *
 * @internal
 */
export interface BrazeKindObservation {
  readonly kind: BrazeKind;
  readonly docsRows: readonly BrazeDocsOperationRow[];
  readonly collectionRows: readonly BrazeCollectionOperationRow[];
  /** Provider ids in this kind that only the collection has — it is the whole `undocumented` kind, or empty. */
  readonly collectionOnly: ReadonlySet<string>;
  readonly malformed: readonly BrazeMalformedAddress[];
  /**
   * Every docs and collection row this run read, across EVERY kind. A rule is dead only when no row anywhere
   * fired it, so this kind's own rows are not enough to decide it.
   */
  readonly runRows: readonly { readonly dispositionRuleId: string }[];
  /**
   * Every reviewed disposition rule. The dead ones raise gaps, and every one is rechecked, so a rule that
   * starts firing closes its gap. Both read this one list, so the gaps and the rechecks cannot disagree on it.
   */
  readonly reviewedRuleIds: readonly string[];
  readonly at: string;
}

const MISSING_FROM_COLLECTION = "collection-missing-documented-operation";
const MISSING_FROM_DOCUMENTATION = "documentation-missing-collection-operation";
const MALFORMED_PATH = "published-path-malformed";
const DEAD_RULE = "disposition-rule-never-fired";

/**
 * The gaps this kind carries after a successful read of both published sources.
 *
 * @param observation everything this run saw for this kind
 * @returns the open gaps, in a stable order
 */
export function brazeOperationGaps({ observation }: { observation: BrazeKindObservation }): readonly BrazeAtlasGap[] {
  return [
    ...credentialGaps({ observation }),
    ...disagreementGaps({ observation }),
    ...malformedGaps({ observation }),
    ...deadRuleGaps({ observation }),
  ];
}

/** The two gaps only a credential can close. Raised for every kind, on every run, by design. */
function credentialGaps({ observation }: { observation: BrazeKindObservation }): readonly BrazeAtlasGap[] {
  const { kind, at } = observation;
  return [
    openBrazeGap({
      at,
      condition: "rest-credential-absent",
      fields: [],
      kind,
      reason:
        "the published surfaces say what Braze offers for this kind; nothing has asked this workspace for " +
        "any of it, because no API key exists to ask with",
      scope: kind,
      surfaces: ["api"],
    }),
    openBrazeGap({
      at,
      condition: "browser-account-absent",
      fields: [],
      kind,
      reason:
        "no Braze account exists on this installation, so no dashboard page governing this kind has been " +
        "reached. MEASURED: the dashboard answers a sign-in wall and no invitation was ever issued",
      scope: kind,
      surfaces: ["browser"],
    }),
  ];
}

/** One gap per operation the two published channels disagree about. Only Braze can close either kind. */
function disagreementGaps({ observation }: { observation: BrazeKindObservation }): readonly BrazeAtlasGap[] {
  const { kind, at } = observation;
  const collectionIds = new Set(observation.collectionRows.map((row) => row.providerId));
  const gaps: BrazeAtlasGap[] = [];
  for (const row of observation.docsRows) {
    if (!collectionIds.has(row.providerId)) {
      gaps.push(
        openBrazeGap({
          at,
          condition: MISSING_FROM_COLLECTION,
          fields: [],
          kind,
          reason: `Braze documents \`${row.providerId}\` and its own official Postman collection does not ship it — only Braze can close this`,
          scope: row.providerId,
          surfaces: ["docs", "collection"],
        }),
      );
    }
  }
  for (const row of observation.collectionRows) {
    if (observation.collectionOnly.has(row.providerId)) {
      gaps.push(
        openBrazeGap({
          at,
          condition: MISSING_FROM_DOCUMENTATION,
          fields: [],
          kind,
          reason: `Braze's official Postman collection ships \`${row.providerId}\` as "${row.name}" and its reference has no page for it at all`,
          scope: row.providerId,
          surfaces: ["docs", "collection"],
        }),
      );
    }
  }
  return gaps;
}

/** One gap per address a published source spells in a form that does not resolve. */
function malformedGaps({ observation }: { observation: BrazeKindObservation }): readonly BrazeAtlasGap[] {
  return observation.malformed.map((defect) =>
    openBrazeGap({
      at: observation.at,
      condition: MALFORMED_PATH,
      fields: [],
      kind: observation.kind,
      reason: `the ${defect.channel} channel publishes an address for \`${defect.providerId}\` that ${defect.detail}. Recorded rather than repaired — a silently corrected path would hide a defect in a document this repository does not control`,
      scope: malformedScope({ channel: defect.channel, providerId: defect.providerId }),
      surfaces: [defect.channel],
    }),
  );
}

/** One gap per reviewed disposition rule that matched nothing at all. */
function deadRuleGaps({ observation }: { observation: BrazeKindObservation }): readonly BrazeAtlasGap[] {
  const deadRules = brazeDeadRuleIds({ reviewedRuleIds: observation.reviewedRuleIds, rows: observation.runRows });
  return deadRules.map((ruleId) =>
    openBrazeGap({
      at: observation.at,
      condition: DEAD_RULE,
      fields: [],
      kind: null,
      reason: `the reviewed disposition rule \`${ruleId}\` matched no operation on either published surface — a dead rule reads as considered judgement and is not one`,
      scope: ruleId,
      surfaces: ["docs", "collection"],
    }),
  );
}

/**
 * The reviewed disposition rules no row on either published channel was classified by.
 *
 * Every reviewed rule is rechecked on every run, so this is the one place that decides which of them stays a
 * gap: a rule some row carries has fired, and its recheck closes any dead-rule row it left behind.
 *
 * @param rows every docs and collection row this run read, across every kind
 * @param reviewedRuleIds every reviewed disposition rule, in declaration order
 * @returns the rules no row carries, in that same order
 * @internal
 */
export function brazeDeadRuleIds({
  rows,
  reviewedRuleIds,
}: {
  rows: readonly { readonly dispositionRuleId: string }[];
  reviewedRuleIds: readonly string[];
}): readonly string[] {
  const fired = new Set(rows.map((row) => row.dispositionRuleId));
  return reviewedRuleIds.filter((id) => !fired.has(id));
}

/**
 * What this run genuinely rechecked for this kind, so a gap whose cause is gone can close.
 *
 * Every operation either channel showed this run is declared resolved for the two disagreement conditions and
 * for the malformed-address condition, and every reviewed disposition rule for the dead-rule condition; the
 * ones that actually fired are raised as gaps above, and the kit gives a raised gap precedence over a recheck
 * of the same pair. So an operation Braze adds to its collection tomorrow closes its own row, one whose
 * address it fixes closes that row, and a rule that starts matching closes its dead-rule row, with no manual
 * step.
 *
 * @param observation everything this run saw for this kind
 * @returns the rechecks, one per condition-and-scope pair this run actually examined
 */
export function brazeOperationRechecks({
  observation,
}: {
  observation: BrazeKindObservation;
}): readonly BrazeGapRecheck[] {
  const rechecks: BrazeGapRecheck[] = [
    { condition: "published-family-undeclared", resolved: true, scope: observation.kind },
    { condition: "published-page-unreadable", resolved: true, scope: observation.kind },
  ];
  for (const row of observation.docsRows) {
    rechecks.push({ condition: MISSING_FROM_COLLECTION, resolved: true, scope: row.providerId });
    rechecks.push({
      condition: MALFORMED_PATH,
      resolved: true,
      scope: malformedScope({ channel: "docs", providerId: row.providerId }),
    });
  }
  for (const row of observation.collectionRows) {
    rechecks.push({ condition: MISSING_FROM_DOCUMENTATION, resolved: true, scope: row.providerId });
    rechecks.push({
      condition: MALFORMED_PATH,
      resolved: true,
      scope: malformedScope({ channel: "collection", providerId: row.providerId }),
    });
  }
  for (const ruleId of observation.reviewedRuleIds) {
    rechecks.push({ condition: DEAD_RULE, resolved: true, scope: ruleId });
  }
  return rechecks;
}

/** One malformed address's scope, spelled once so the gap and its recheck cannot drift apart. */
function malformedScope({
  channel,
  providerId,
}: {
  channel: BrazeMalformedAddress["channel"];
  providerId: string;
}): string {
  return `${channel}:${providerId}`;
}
