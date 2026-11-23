/**
 * The publication audit's pure core: judge text the fleet already published through the ONE outbound privacy check
 * (`../../outbound/privacyCheck.ts`), and reduce every hit to a sanitised {@link PublicationFinding}.
 *
 * The privacy check's header names this caller — "a sweep or a leak audit calls it on text already posted" — and
 * the rules are the outbound guards' own, so a text the write transports would refuse today is exactly a text this
 * audit reports. The destination is the strict one: the own repository's address is forgiven, nothing else is.
 *
 * ## What leaves this module
 *
 * A class, a door, a link, the fixed names of the fields it sat in, and an id. The check's `message` and `locus` stay here: each is printable under the
 * private terms, but each still says where in a text the hit sits, and an audit's output is read by more surfaces
 * than a refusal's. The id is a digest of coordinates only (door, object, class), so it can be stored and compared
 * without carrying anything found.
 *
 * ## The link is judged too
 *
 * A link is published text as well, so it is run through the same check before it is kept. One that a rule
 * matches is withheld (`link: null`) rather than replaced by a title, which would be the one substitute more likely
 * to carry a term. A link the reader marked `linkCarriesNoText` — checked against a shape whose only free text is the
 * own repository's address, which the check forgives — is kept unjudged: its path words and digits carry nothing,
 * and judging them only withholds a link for a pattern that happens to match `pull` or `issues`.
 *
 * The own repository's address is published by construction and forgiven by this same check on every outbound
 * door, so a finding's link carrying it is the address the card has to cite, not a leak.
 *
 * Pure: no I/O.
 */
import { createHash } from "node:crypto";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../hygiene/forbiddenIdentifiers.js";
import type { ForbiddenIdentifierRules } from "../../hygiene/identifierScan.js";
import type { PrivateTerm } from "../../hygiene/privateTerms.js";
import { checkPrivacy, type PrivacyFinding, UNASSESSED_PERSONAL_MATERIAL } from "../../outbound/privacyCheck.js";

import type {
  PublicationClass,
  PublicationCounts,
  PublicationDoor,
  PublicationFinding,
  PublishedText,
} from "./types.js";

/** The rules one audit judges with: the outbound guards' own policy, and the repository whose address is forgiven. */
export interface PublicationAuditPolicy {
  /** The private denylist; empty still catches every credential shape. */
  readonly denylist: readonly string[];
  /** The installation's private terms, loaded fail-closed by the caller. */
  readonly privateTerms: readonly PrivateTerm[];
  /** `owner/repo`, whose own address the identifier half and the private terms do not count. */
  readonly ownRepository: string | undefined;
  /** The forbidden-identifier rules; the committed ones unless a test injects synthetic ones. */
  readonly identifierRules?: ForbiddenIdentifierRules | undefined;
}

/** A hygiene label that may be carried as it stands: a plain lowercase slug. */
const SAFE_LABEL = /^[a-z0-9][a-z0-9-]{0,47}$/u;

/** The locus every judged text is given — fixed, so nothing about the object reaches a message. */
const AUDIT_LOCUS = "published text";

/**
 * The class one privacy finding names.
 *
 * @param finding one finding from the privacy check
 * @returns its category and kind, label or class; `hygiene/unnamed` for a label that is not a plain slug
 */
function publicationClassOf({ finding }: { finding: PrivacyFinding }): PublicationClass {
  if (finding.code === "INSTALLATION_STATE") {
    return `installation-state/${finding.kind}`;
  }
  if (finding.code === "PRIVATE_TERM") {
    return `private-term/${finding.className}`;
  }
  if (SAFE_LABEL.test(finding.label)) {
    return `hygiene/${finding.label}`;
  }
  return "hygiene/unnamed";
}

/**
 * Every privacy finding in one text, judged at the strict destination.
 *
 * @param text the text exactly as published
 * @param policy the audit's rules
 * @returns the check's findings, never echoed past this module
 */
function privacyFindings({
  text,
  policy,
}: {
  text: string;
  policy: PublicationAuditPolicy;
}): readonly PrivacyFinding[] {
  const { identifierRules = FORBIDDEN_IDENTIFIER_RULES } = policy;
  return checkPrivacy({
    content: { locus: AUDIT_LOCUS, text },
    destination: {
      identifierAudience: "strict",
      installationIdentifiers: undefined,
      ownRepository: policy.ownRepository,
    },
    personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
    policy: { denylist: policy.denylist, identifierRules, privateTerms: policy.privateTerms },
  }).findings;
}

/**
 * The stable id of one finding: a digest of the door, the object's coordinates and the class — nothing found.
 *
 * @returns sixteen hex characters
 */
export function publicationFindingId({
  door,
  objectKey,
  className,
}: {
  door: PublicationDoor;
  objectKey: string;
  className: PublicationClass;
}): string {
  return createHash("sha256").update(`${door}\n${objectKey}\n${className}`).digest("hex").slice(0, 16);
}

/**
 * The link a finding keeps: as it stands when the reader marked it textless, else judged once per address and
 * withheld (`null`) when a rule matches the address itself.
 *
 * @param cache each judged address's verdict, true for withheld, shared across one audit
 * @returns the link, or `null` when withheld
 */
function keptLink({
  published,
  policy,
  cache,
}: {
  published: PublishedText;
  policy: PublicationAuditPolicy;
  cache: Map<string, boolean>;
}): string | null {
  if (published.linkCarriesNoText) {
    return published.link;
  }
  let withheld = cache.get(published.link);
  if (withheld === undefined) {
    withheld = privacyFindings({ policy, text: published.link }).length > 0;
    cache.set(published.link, withheld);
  }
  return withheld ? null : published.link;
}

/**
 * Judge every published text and reduce the hits to sanitised findings: one per object per class, in first-seen
 * order.
 *
 * @param texts the published texts, read back as they stand
 * @param policy the audit's rules
 * @returns the findings, and how many links were withheld because a rule matched the address itself
 */
export function auditPublishedTexts({
  texts,
  policy,
}: {
  texts: readonly PublishedText[];
  policy: PublicationAuditPolicy;
}): { readonly findings: readonly PublicationFinding[]; readonly withheldLinks: number } {
  const byId = new Map<
    string,
    { readonly finding: Omit<PublicationFinding, "fields">; readonly fields: Set<string> }
  >();
  const linkWithheld = new Map<string, boolean>();
  for (const published of texts) {
    for (const finding of privacyFindings({ policy, text: published.text })) {
      const className = publicationClassOf({ finding });
      const findingId = publicationFindingId({ className, door: published.door, objectKey: published.objectKey });
      const seen = byId.get(findingId);
      if (seen !== undefined) {
        seen.fields.add(published.field);
        continue;
      }
      const link = keptLink({ cache: linkWithheld, policy, published });
      byId.set(findingId, {
        fields: new Set([published.field]),
        finding: { className, door: published.door, findingId, link },
      });
    }
  }
  const findings = [...byId.values()].map(({ finding, fields }) => ({ ...finding, fields: [...fields].toSorted() }));
  return { findings, withheldLinks: findings.filter((finding) => finding.link === null).length };
}

/**
 * Count findings by door, then by class, with keys in sorted order so two runs print identically.
 *
 * @returns the nested counts; a door with no finding is absent
 */
export function countPublicationFindings({ findings }: { findings: readonly PublicationFinding[] }): PublicationCounts {
  const counts = new Map<string, Map<string, number>>();
  for (const finding of findings) {
    let byClass = counts.get(finding.door);
    if (byClass === undefined) {
      byClass = new Map<string, number>();
      counts.set(finding.door, byClass);
    }
    const before = byClass.get(finding.className);
    byClass.set(finding.className, before === undefined ? 1 : before + 1);
  }
  return Object.fromEntries(
    [...counts.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([door, byClass]) => [
        door,
        Object.fromEntries([...byClass.entries()].toSorted(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}
