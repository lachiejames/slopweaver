/**
 * The pre-write sensitivity gate every atlas that needs one shares — the last thing that runs before a byte
 * reaches disk, and the one that REFUSES rather than redacts.
 *
 * ## What is shared, and what each platform still supplies
 *
 * The mechanism generalises exactly: walk the document for forbidden KEY names, run a set of value-shape
 * patterns over the bytes about to be written, run the public hygiene gate's own leak classes over the same
 * bytes, and split the findings into refusals and reports. What does not generalise is the VOCABULARY — the
 * key words that name a credential on this platform, the value shapes it emits, and which leak classes are
 * expected rather than alarming. Those are the {@link AtlasSensitivityPolicy}, declared by the platform in
 * its own module where a reviewer reads them beside the payloads they guard.
 *
 * Two atlases had this byte-identical, which is what made it kit-owned: a gate that reads the OUTPUT cannot
 * be defeated by a mistake upstream of it, and that property is worth having once rather than twice.
 *
 * ## Refuse versus report is a real decision, not a softening
 *
 * A forbidden key and a credential-shaped value REFUSE. A leak class the policy names as expected — the
 * private denylist, for an atlas whose whole subject is the organisation — is recorded and printed and does
 * not. Refusing on those words would leave the owner with a gate that is only ever satisfied by an empty
 * atlas, which is the "gate that always refuses is not a gate" failure.
 */
import { createHash } from "node:crypto";

import { scanContent } from "../../hygiene/scan.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stableJson } from "../atlasFile.js";

import { AtlasPublishErrors, atlasPublishErrorLines } from "./publishErrors.js";

/** One thing the gate found, and where. */
export interface AtlasSensitivityFinding {
  /** `refuse` stops the publish; `report` is recorded and printed but does not. */
  readonly disposition: "refuse" | "report";
  /** What was found, in the policy's own closed vocabulary. */
  readonly label: string;
  /** The JSON path to the offending node. */
  readonly path: string;
  /** Why, in English — never the offending VALUE. */
  readonly reason: string;
  /** A digest of the offending value, so two runs can be compared without either printing a secret. */
  readonly witness: string;
}

/** What one platform declares about its own secrets. */
export interface AtlasSensitivityPolicy {
  /**
   * Key-name parts that must never appear. Matched against a key split on `_`, `-` and `camelCase`, and
   * against those parts JOINED — which is what catches `apiKey`, whose halves are both innocent.
   */
  readonly forbiddenKeyParts: ReadonlySet<string>;
  /** Value shapes that must never appear, whatever key they arrived under. */
  readonly valuePatterns: readonly { readonly label: string; readonly re: RegExp }[];
  /** Public leak classes this atlas RECORDS rather than refuses, each with the reason to carry. */
  readonly reportedLeakClasses: ReadonlyMap<string, string>;
}

/**
 * A digest standing in for a value the gate must not print.
 *
 * @param value the offending text
 * @returns a short, stable digest
 */
function witnessOf({ value }: { value: string }): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Split one key into the parts a policy's forbidden set is matched against.
 *
 * @param key the object key
 * @returns its lowercased parts
 */
export function atlasKeyParts({ key }: { key: string }): readonly string[] {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0);
}

/**
 * Whether one key names something a policy forbids.
 *
 * @param key the object key
 * @param policy the platform's own vocabulary
 * @returns `true` when any part, or the parts joined, is a forbidden word
 */
export function isForbiddenAtlasKey({ key, policy }: { key: string; policy: AtlasSensitivityPolicy }): boolean {
  const parts = atlasKeyParts({ key });
  return parts.some((part) => policy.forbiddenKeyParts.has(part)) || policy.forbiddenKeyParts.has(parts.join(""));
}

/**
 * Walk a document for forbidden key names.
 *
 * @param node the current node
 * @param path the JSON path to it
 * @param policy the platform's own vocabulary
 * @param into where findings accumulate
 */
function walkForForbiddenKeys({
  node,
  path,
  policy,
  into,
}: {
  node: unknown;
  path: string;
  policy: AtlasSensitivityPolicy;
  into: AtlasSensitivityFinding[];
}): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      walkForForbiddenKeys({ into, node: entry, path: `${path}.${String(index)}`, policy });
    });
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const key of Object.keys(node)) {
    const here = path === "" ? key : `${path}.${key}`;
    if (isForbiddenAtlasKey({ key, policy })) {
      into.push({
        disposition: "refuse",
        label: "forbidden-key",
        path: here,
        reason: `the key \`${key}\` names a credential or a personal identifier this atlas never holds`,
        witness: witnessOf({ value: key }),
      });
    }
    walkForForbiddenKeys({ into, node: node[key], path: here, policy });
  }
}

/**
 * Every sensitivity finding in one document: forbidden keys first, then value shapes and the public gate's
 * own leak classes over the exact bytes that would be written.
 *
 * Pure — the denylist is passed in rather than read, so this is testable without a home directory and cannot
 * be defeated by an unreadable file.
 *
 * @param document the generation document about to be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param policy the platform's own vocabulary
 * @returns every finding, refusals and reports alike
 */
export function scanAtlasSensitivity({
  document,
  denylist,
  policy,
}: {
  document: unknown;
  denylist: readonly string[];
  policy: AtlasSensitivityPolicy;
}): readonly AtlasSensitivityFinding[] {
  const findings: AtlasSensitivityFinding[] = [];
  walkForForbiddenKeys({ into: findings, node: document, path: "", policy });

  const bytes = stableJson({ value: document });
  for (const { label, re } of policy.valuePatterns) {
    // A fresh copy per scan: `exec` on a `g` or `y` pattern reads and advances `lastIndex`, so the policy's own
    // object would carry state from one document into the next and miss a match there.
    const match = new RegExp(re.source, re.flags).exec(bytes);
    if (match !== null) {
      findings.push({
        disposition: "refuse",
        label,
        path: "<document>",
        reason: `a value matching the ${label} shape reached the document`,
        witness: witnessOf({ value: match[0] }),
      });
    }
  }
  for (const hit of scanContent({ content: bytes, denylist, path: "<atlas-document>" })) {
    const path = `<document>:${String(hit.line)}`;
    const witness = witnessOf({ value: hit.excerpt });
    // A leak class the atlas does not declare as recorded is refused; a recorded one carries its own reason.
    const reported = policy.reportedLeakClasses.get(hit.label);
    if (reported === undefined) {
      const reason = `a value matching the ${hit.label} leak class reached the document`;
      findings.push({ disposition: "refuse", label: hit.label, path, reason, witness });
      continue;
    }
    findings.push({ disposition: "report", label: hit.label, path, reason: reported, witness });
  }
  return findings;
}

/**
 * Decide whether a document may be written.
 *
 * @param document the generation document about to be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param policy the platform's own vocabulary
 * @param label what is being written, for the refusal message — e.g. `workspaces.json`
 * @returns the findings to record on success, or every reason the write is refused
 */
export function admitAtlasDocument({
  document,
  denylist,
  policy,
  label,
}: {
  document: unknown;
  denylist: readonly string[];
  policy: AtlasSensitivityPolicy;
  label: string;
}): Result<readonly AtlasSensitivityFinding[]> {
  const findings = scanAtlasSensitivity({ denylist, document, policy });
  const refusals = findings.filter((finding) => finding.disposition === "refuse");
  if (refusals.length > 0) {
    return err(
      atlasPublishErrorLines({ error: AtlasPublishErrors.sensitiveValueRefused({ findings: refusals, label }) }),
    );
  }
  return ok(findings);
}
