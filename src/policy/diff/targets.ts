/**
 * Where every name a diff record links goes: an evidence slot, a policy, or an address the record spells out.
 *
 * A record names a Vanta thing by its id (`vanta-evidence:network-diagram`, `vanta-policy:<id>`) rather than by a
 * pasted URL, so the link is built from the atlas the same way every other Vanta link in this repo is, and a
 * renamed or deleted slot is refused here rather than published as a dead link. Every policy the atlas holds is a
 * phrase too: a document that names "Secure Development Policy" links it without the record having to ask.
 *
 * Pure — the atlas arrives already read.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type DocDiffIssue, DocDiffIssues } from "./issues.js";
import type { PhraseLink } from "./link.js";
import type { DocDiffRecord } from "./record.js";

/** One Vanta evidence slot, as the atlas holds it. */
export interface EvidenceTarget {
  readonly id: string;
  readonly url: string;
}

/** One Vanta policy, its page already addressed. */
export interface PolicyTarget {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/** What a record's links resolve to. */
export interface ResolvedTargets {
  /** Every phrase to link, the record's own first. */
  readonly phrases: readonly PhraseLink[];
  /** Each evidence slot's address, by evidence id. */
  readonly slotUrls: ReadonlyMap<string, string>;
}

/** The URL one record target names, or null when the atlas holds nothing under it. */
function targetUrl({
  target,
  evidence,
  policies,
}: {
  target: string;
  evidence: ReadonlyMap<string, string>;
  policies: ReadonlyMap<string, string>;
}): string | null {
  if (target.startsWith("https://")) {
    return target;
  }
  if (target.startsWith("vanta-evidence:")) {
    const slot = evidence.get(target.slice("vanta-evidence:".length));
    if (slot === undefined) {
      return null;
    }
    return slot;
  }
  const policy = policies.get(target.slice("vanta-policy:".length));
  if (policy === undefined) {
    return null;
  }
  return policy;
}

/**
 * The link target a document's Vanta address resolves through: a policy as written, a bare id as its evidence slot.
 *
 * @param vantaEvidence the document's `vantaEvidence`
 * @returns a target `targetUrl` resolves
 */
function documentTarget({ vantaEvidence }: { vantaEvidence: string }): string {
  if (vantaEvidence.startsWith("vanta-policy:")) {
    return vantaEvidence;
  }
  return `vanta-evidence:${vantaEvidence}`;
}

/**
 * Resolve every target a record names against the atlas.
 *
 * @param record the validated record
 * @param evidence every evidence slot the atlas holds
 * @param policies every policy the atlas holds
 * @returns the phrases and slot addresses, or every target nothing in the atlas answers
 */
export function resolveTargets({
  record,
  evidence,
  policies,
}: {
  record: DocDiffRecord;
  evidence: readonly EvidenceTarget[];
  policies: readonly PolicyTarget[];
}): Result<ResolvedTargets, readonly DocDiffIssue[]> {
  const evidenceUrls = new Map(evidence.map((slot) => [slot.id, slot.url]));
  const policyUrls = new Map(policies.map((policy) => [policy.id, policy.url]));
  const issues: DocDiffIssue[] = [];
  const phrases: PhraseLink[] = [];
  for (const link of record.links) {
    const url = targetUrl({ evidence: evidenceUrls, policies: policyUrls, target: link.target });
    if (url === null) {
      issues.push(DocDiffIssues.unresolvedLink({ target: link.target }));
    } else {
      phrases.push({ text: link.text, url });
    }
  }
  const slotUrls = new Map<string, string>();
  for (const document of record.documents) {
    const target = documentTarget({ vantaEvidence: document.vantaEvidence });
    const url = targetUrl({ evidence: evidenceUrls, policies: policyUrls, target });
    if (url === null) {
      issues.push(DocDiffIssues.unresolvedLink({ target }));
    } else {
      slotUrls.set(document.vantaEvidence, url);
    }
  }
  if (issues.length > 0) {
    return err(issues);
  }
  const named = new Set(phrases.map((phrase) => phrase.text.toLowerCase()));
  const policyPhrases = policies
    .filter((policy) => !named.has(policy.name.toLowerCase()))
    .map((policy) => ({ text: policy.name, url: policy.url }));
  return ok({ phrases: [...phrases, ...policyPhrases], slotUrls });
}
