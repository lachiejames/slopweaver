/**
 * The pre-write sensitivity gate: the last thing that runs before a byte of this atlas reaches disk, and
 * the one that REFUSES rather than redacts.
 *
 * The owner's line for this platform is stronger than the one the Vanta atlas was built to: never fetch,
 * store, log, journal or index an item's secret fields. Three mechanisms carry that, and they are
 * deliberately independent, so no single mistake defeats all three:
 *
 * 1. **A closed command allowlist** (`inventory.ts`) — the verbs that would return an item's contents are
 *    absent from it, so there is no code path that fetches one.
 * 2. **An allowlist projection** (`model.ts`) — every stored field is named by a schema the provider's own
 *    JSON is parsed through, so an unrecognised field is dropped rather than stored.
 * 3. **This file** — a scan over the exact bytes about to be written. It exists because 1 and 2 are the
 *    kinds of thing a later edit can quietly undo, and a gate that reads the OUTPUT cannot be undone by a
 *    mistake upstream of it. If a projection ever regresses to passing provider JSON through wholesale, the
 *    key names alone stop the publish.
 *
 * ## What refuses, and what only reports
 *
 * Leak-class shapes and forbidden key names REFUSE. The private hygiene denylist REPORTS.
 *
 * That split is a real decision and not a softening. The denylist at `$SLOPWEAVER_HOME/hygiene-denylist.txt`
 * exists to keep organisation-specific words out of the GIT REPOSITORY — `src/hygiene/scan.ts` scans
 * `git ls-files` and nothing else, and has never been pointed at the state home, where the corpus has always
 * held the organisation's own data. This atlas's entire subject is that organisation: its people, its
 * groups, its vault names. Refusing a write on a denylist hit would refuse essentially every generation and
 * leave the owner with a gate that is only ever satisfied by an empty atlas, which is the "gate that always
 * refuses is not a gate" failure. So the denylist runs, every hit is reported and recorded as a gap, and the
 * refusal is reserved for the half that genuinely means a secret got in.
 */
import { createHash } from "node:crypto";

import { SYNTHETIC_WORKSPACE_ID_LABEL, scanContent } from "../../hygiene/scan.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { kindFileLines, stableJson } from "../atlasFile.js";
import { OnepasswordSyncErrors, onepasswordSyncErrorLines } from "./syncErrors.js";

/** One thing the gate found, and where. */
export interface OnepasswordSensitivityFinding {
  /** `refuse` stops the publish; `report` is recorded and printed but does not. */
  readonly disposition: "refuse" | "report";
  /** What was found, in the gate's own closed vocabulary. */
  readonly label: string;
  /** The JSON path to the offending node, e.g. `entities.3.channels.admin-cli.detail.password`. */
  readonly path: string;
  /** Why, in English — never the offending VALUE. See {@link witness}. */
  readonly reason: string;
  /** A digest of the offending value, so two runs can be compared without either printing a secret. */
  readonly witness: string;
}

/**
 * Object keys that must never appear anywhere in a published generation.
 *
 * Matched case-insensitively against a key that has been split on `_`, `-` and `camelCase`, so `notesPlain`,
 * `notes_plain` and `NotesPlain` are one rule rather than three. A key is forbidden when ANY of its parts
 * is one of these words — `totp` alone and `otp` inside `otpCode` both fire.
 *
 * This is a vocabulary of 1Password's own item schema plus the generic credential words, and it is
 * deliberately broad: a false positive here costs a schema field being renamed, and a false negative costs a
 * password on disk.
 */
const FORBIDDEN_KEY_WORDS: readonly string[] = [
  "attachment",
  "credential",
  "credentials",
  "document",
  "documents",
  "notesplain",
  "onetimepassword",
  "otp",
  "passphrase",
  "password",
  "private",
  "recovery",
  "secret",
  "seed",
  "sshkey",
  "totp",
];

/**
 * Keys whose NAME is forbidden by {@link FORBIDDEN_KEY_WORDS} but which this atlas legitimately stores.
 *
 * EMPTY, and measured so rather than assumed: every field name in `model.ts` was checked against
 * {@link FORBIDDEN_KEY_WORDS} and none of them collides, so the atlas as it stands needs no allowance at
 * all. Reproduce with `yarn vitest run src/__tests__/unit/atlas/onepassword/sensitivity.test.ts`, whose
 * `every stored field name survives the forbidden-key walk` case fails the moment a new field collides.
 *
 * It is kept as an empty set rather than deleted because the alternative — a future field that genuinely
 * needs an exception — would otherwise be resolved by widening {@link FORBIDDEN_KEY_WORDS}, which weakens
 * the rule for the whole atlas instead of for one field. Matching is on the WHOLE lowercased key, so an
 * allowance can never widen into a word-level escape.
 */
const FORBIDDEN_KEY_ALLOWANCES: ReadonlySet<string> = new Set();

/**
 * Value shapes that mean a credential reached the document. The first five are the leak classes the public
 * hygiene gate already knows; these are the two it does not, both specific to this platform.
 *
 * - `ops_` prefixes a 1Password service-account token.
 * - `A3-` prefixes a 1Password Secret Key, which is the second half of an account credential.
 */
const ONEPASSWORD_CREDENTIAL_PATTERNS: readonly { readonly label: string; readonly re: RegExp }[] = [
  { label: "onepassword-service-account-token", re: /ops_[A-Za-z0-9._-]{20,}/ },
  { label: "onepassword-secret-key", re: /A3-[A-Z0-9]{6}-[A-Z0-9]{6}/ },
];

/**
 * Public leak classes this atlas RECORDS rather than refuses, and the one thing they have in common: each
 * is about what may be committed to the git repository, not about whether a credential got in.
 *
 * `raw-workspace-id` is `\b(?=[A-Z0-9]*[0-9])[CUAWDGTE][A-Z0-9]{8,}\b` — a Slack/Linear id shape, reported
 * as `synthetic-workspace-id` when the uuid happens to spell a synthetic stand-in. Measured on
 * the first real events pull: it fired throughout one audit-events generation and no
 * other class fired at all. Every hit was a 1Password entity uuid that happens to begin C, U, A or W.
 * That is not a near miss, it is the atlas's own PRIMARY KEY — refusing on it means this atlas can never
 * publish a single generation, which is precisely the "gate that always refuses is not a gate" failure the
 * header above rejects for the denylist. Reproduce with `slopweaver onepassword sync` against a real
 * Events API token.
 *
 * The classes NOT listed here still refuse, and that is the whole point of listing rather than disabling:
 * every credential shape the public gate knows (`slack-token`, `github-pat`, `client-secret`,
 * `openai-style-key`, …) plus this platform's own two in {@link ONEPASSWORD_CREDENTIAL_PATTERNS} means a
 * credential reached the document, and a credential in a 1Password atlas is the one thing being guarded
 * against. `absolute-home-path` also still refuses — it has never fired here, so nothing forced a decision
 * on it, and leaving it strict costs nothing.
 */
const REPORTED_LEAK_CLASSES: ReadonlySet<string> = new Set([
  "denylist",
  "raw-workspace-id",
  SYNTHETIC_WORKSPACE_ID_LABEL,
]);

/**
 * A digest of a value, so a finding can be compared and logged without the value itself ever being written
 * to a terminal, a journal or an error message.
 *
 * @param value the offending value
 * @returns the first 16 hex characters of its sha-256
 */
function witnessOf({ value }: { value: string }): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Split a key into lowercase words on `_`, `-` and `camelCase` boundaries, so one rule covers every spelling.
 *
 * @param key the object key
 * @returns its lowercased parts
 */
function keyWords({ key }: { key: string }): readonly string[] {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0);
}

/**
 * Whether one object key is forbidden.
 *
 * @param key the object key
 * @returns the forbidden word it matched, or `null`
 */
function forbiddenWordIn({ key }: { key: string }): string | null {
  const lowered = key.toLowerCase();
  if (FORBIDDEN_KEY_ALLOWANCES.has(lowered)) {
    return null;
  }
  const parts = keyWords({ key });
  const matched = FORBIDDEN_KEY_WORDS.find((word) => lowered === word || parts.includes(word));
  if (matched === undefined) {
    // No forbidden word in this key: the ordinary, permitted case.
    return null;
  }
  return matched;
}

/** Walk every node of a document, reporting a forbidden key wherever one appears. */
function walkForForbiddenKeys({
  node,
  path,
  into,
}: {
  node: unknown;
  path: string;
  into: OnepasswordSensitivityFinding[];
}): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      walkForForbiddenKeys({ into, node: entry, path: `${path}.${String(index)}` });
    });
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const key of Object.keys(node)) {
    const here = path === "" ? key : `${path}.${key}`;
    const forbidden = forbiddenWordIn({ key });
    if (forbidden !== null) {
      into.push({
        disposition: "refuse",
        label: "forbidden-key",
        path: here,
        reason: `the key "${key}" carries the forbidden word "${forbidden}" — this atlas never stores an item's secret fields`,
        witness: witnessOf({ value: key }),
      });
    }
    walkForForbiddenKeys({ into, node: node[key], path: here });
  }
}

/**
 * Why one public leak-class hit was recorded or refused, in the gate's own words.
 *
 * @param label the public gate's class name
 * @returns the reason to carry on the finding
 */
function reasonForLeakClass({ label }: { label: string }): string {
  if (label === "denylist") {
    return "a private denylist word appears — recorded, not refused, because this atlas's subject IS the organisation";
  }
  if (label === "raw-workspace-id" || label === SYNTHETIC_WORKSPACE_ID_LABEL) {
    return "a provider-identifier shape appears — recorded, not refused, because a 1Password entity uuid IS this atlas's primary key; see REPORTED_LEAK_CLASSES";
  }
  return `a value matching the ${label} leak class reached the document`;
}

/**
 * Every value-shape and denylist finding in one serialised string — the 1Password credential shapes, then the
 * public gate's own leak classes.
 *
 * @param bytes the serialised text, exactly as it would reach disk
 * @param denylist the private organisation words
 * @param locate names where a finding sits; `line` is the hit's line WITHIN `bytes`, or `null` for a
 *   1Password shape, which is matched over the whole string
 * @returns the findings, in the order they were found
 */
function valueFindings({
  bytes,
  denylist,
  locate,
}: {
  bytes: string;
  denylist: readonly string[];
  locate: (input: { line: number | null }) => string;
}): OnepasswordSensitivityFinding[] {
  const findings: OnepasswordSensitivityFinding[] = [];
  for (const { label, re } of ONEPASSWORD_CREDENTIAL_PATTERNS) {
    const match = re.exec(bytes);
    if (match !== null) {
      findings.push({
        disposition: "refuse",
        label,
        path: locate({ line: null }),
        reason: `a value matching the ${label} shape reached the document`,
        witness: witnessOf({ value: match[0] }),
      });
    }
  }

  // The public gate's own leak classes, run over the serialised bytes. `scanContent` takes a path only for
  // reporting, so a synthetic one keeps this pure.
  for (const hit of scanContent({ content: bytes, denylist, path: "<atlas-document>" })) {
    findings.push({
      disposition: REPORTED_LEAK_CLASSES.has(hit.label) ? "report" : "refuse",
      label: hit.label,
      path: locate({ line: hit.line }),
      reason: reasonForLeakClass({ label: hit.label }),
      witness: witnessOf({ value: hit.excerpt }),
    });
  }
  return findings;
}

/**
 * Every sensitivity finding in one bounded document — the MANIFEST — in the order they were found: forbidden
 * keys first (a structural walk), then value-shape and denylist hits over the exact bytes that would be
 * written. A kind file is not bounded and goes through {@link scanKindFileForSensitivity} instead.
 *
 * Pure — the denylist is passed in rather than read, so this is testable without a home directory and
 * cannot be defeated by an unreadable file.
 *
 * @param document the generation document about to be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @returns every finding, refusals and reports alike
 */
export function scanForSensitivity({
  document,
  denylist,
}: {
  document: unknown;
  denylist: readonly string[];
}): readonly OnepasswordSensitivityFinding[] {
  const findings: OnepasswordSensitivityFinding[] = [];
  walkForForbiddenKeys({ into: findings, node: document, path: "" });
  const located = valueFindings({
    bytes: stableJson({ value: document }),
    denylist,
    locate: ({ line }) => (line === null ? "<document>" : `<document>:${String(line)}`),
  });
  findings.push(...located);
  return findings;
}

/**
 * Every sensitivity finding in one KIND FILE, scanned the way the kit writes it: one `.jsonl` line at a time.
 *
 * A kind file's size is the tenant's, not this code's. MEASURED: the `events` kind's pretty-printed whole
 * was weighed against `safeJsonStringify`'s 104,857,600-character refusal, and it only grows because an event outside the walk window is marked stale rather than dropped.
 * Reproduce the size with `wc -c ~/.slopweaver/atlas/onepassword/events.jsonl`. So the value scan reads the
 * very lines `kindFileLines` hands the writer — which is also more faithful than the pretty form ever was,
 * since those ARE the bytes on disk — and the largest string it ever holds is one entity.
 *
 * Forbidden-key paths are unchanged (`entities.<i>.…`); a value finding's path is its line in the file,
 * `<kind file>:1` being the envelope and `<kind file>:2` the first entity.
 *
 * @param envelope the kind file with its entities emptied — line 1
 * @param entities the entities, one line each after it
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @returns every finding, refusals and reports alike: forbidden keys first, then value findings in line order
 */
export function scanKindFileForSensitivity({
  envelope,
  entities,
  denylist,
}: {
  envelope: unknown;
  entities: readonly unknown[];
  denylist: readonly string[];
}): readonly OnepasswordSensitivityFinding[] {
  const findings: OnepasswordSensitivityFinding[] = [];
  walkForForbiddenKeys({ into: findings, node: envelope, path: "" });
  entities.forEach((entity, index) => {
    walkForForbiddenKeys({ into: findings, node: entity, path: `entities.${String(index)}` });
  });
  let lineNumber = 0;
  for (const bytes of kindFileLines({ entities, envelope })) {
    lineNumber += 1;
    const path = `<kind file>:${String(lineNumber)}`;
    findings.push(...valueFindings({ bytes, denylist, locate: () => path }));
  }
  return findings;
}

/** Admit the findings when none refuses, else refuse with every refusal named. */
function admitFindings({
  findings,
  label,
}: {
  findings: readonly OnepasswordSensitivityFinding[];
  label: string;
}): Result<readonly OnepasswordSensitivityFinding[]> {
  const refusals = findings.filter((finding) => finding.disposition === "refuse");
  if (refusals.length > 0) {
    return err(onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.documentRefused({ label, refusals }) }));
  }
  return ok(findings);
}

/**
 * Decide whether a bounded document — the manifest — may be written.
 *
 * @param document the generation document about to be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param label what is being written, for the refusal message — e.g. `the manifest`
 * @returns the findings to record on success, or every reason the write is refused
 */
export function admitOnepasswordDocument({
  document,
  denylist,
  label,
}: {
  document: unknown;
  denylist: readonly string[];
  label: string;
}): Result<readonly OnepasswordSensitivityFinding[]> {
  return admitFindings({ findings: scanForSensitivity({ denylist, document }), label });
}

/**
 * Decide whether a kind file may be written, scanning it line by line — see {@link scanKindFileForSensitivity}.
 *
 * @param envelope the kind file with its entities emptied
 * @param entities the entities, in the order they will be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param label what is being written, for the refusal message — e.g. `events file`
 * @returns the findings to record on success, or every reason the write is refused
 */
export function admitOnepasswordKindFile({
  envelope,
  entities,
  denylist,
  label,
}: {
  envelope: unknown;
  entities: readonly unknown[];
  denylist: readonly string[];
  label: string;
}): Result<readonly OnepasswordSensitivityFinding[]> {
  return admitFindings({ findings: scanKindFileForSensitivity({ denylist, entities, envelope }), label });
}
