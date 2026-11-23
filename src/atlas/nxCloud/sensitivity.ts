/**
 * This atlas's own secrets vocabulary — the words, shapes and expectations `kit/sensitivity.ts` runs with.
 *
 * ## Why this atlas needs a gate at all
 *
 * Because its source is a web client's own loader payloads, and those carry the client's configuration
 * alongside the data. MEASURED on a single `overview.data` response: a Rollbar access token, a
 * PostHog API key, an Auth0 client id and audience, an avatar URL and an email hash — none of it Nx Cloud
 * ground truth, all of it in the same object as the workspace record this atlas wants.
 *
 * `projection.ts` already names every field that is kept, so none of that reaches a generation today. The
 * gate exists because that is exactly the kind of thing a later edit can quietly undo: a check that reads the
 * OUTPUT cannot be defeated by a mistake upstream of it. If a projection ever regresses to passing payloads
 * through wholesale, the key names alone stop the publish.
 */
import type { Result } from "../../lib/result.js";
import {
  type AtlasSensitivityFinding,
  type AtlasSensitivityPolicy,
  admitAtlasDocument,
  atlasKeyParts,
  isForbiddenAtlasKey,
  scanAtlasSensitivity,
} from "../kit/sensitivity.js";

/**
 * One thing the gate found, and where. Kit-owned.
 *
 * @internal
 */
export type NxCloudSensitivityFinding = AtlasSensitivityFinding;

/**
 * Key-name parts that must never appear anywhere in a published generation.
 *
 * Deliberately broad: a false positive costs one schema field a rename, and a false negative costs a
 * credential on disk. `avatar` and `hash` are here for a reason that is not secrecy — the payload's
 * `emailHash` and avatar URL are personal identifiers of the signed-in person that this atlas has no use
 * for, and a key that reached the document would mean the projection stopped being an allowlist.
 */
const FORBIDDEN_KEY_PARTS: ReadonlySet<string> = new Set([
  "apikey",
  "auth0",
  "avatar",
  "bearer",
  "cookie",
  "credential",
  "hash",
  "jwt",
  "password",
  "posthog",
  "rollbar",
  "secret",
  "session",
  "token",
]);

/**
 * Value shapes that must never appear, whatever key they arrived under.
 *
 * There is deliberately **no long-hex rule**, and its absence is a decision rather than an oversight: this
 * atlas's own entity ids are 32 hex characters and every artifact reference carries a 64-character SHA-256,
 * so a length-based hex rule either refuses every generation it is meant to admit or is tuned so narrowly
 * that it catches nothing. The credential that motivated this gate — a Rollbar access token in the client's
 * `ENV` block — is caught by its KEY, which is what the forbidden-key walk is for.
 */
const VALUE_PATTERNS: readonly { readonly label: string; readonly re: RegExp }[] = [
  { label: "posthog-key", re: /\bphc_[A-Za-z0-9]{20,}\b/ },
  { label: "bearer-jwt", re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: "nx-cloud-session-cookie", re: /_nxCloudSession=/ },
];

/**
 * The public gate's leak classes this atlas RECORDS rather than refuses.
 *
 * Exactly one, because only one applies: this atlas's subject IS the organisation, so a denylist hit is
 * expected and refusing on it would admit only an empty atlas. Every other class stays a refusal —
 * `raw-workspace-id` is not softened here the way the 1Password atlas softens it, because that pattern
 * matches Slack-shaped identifiers and no Nx Cloud id is one, so keeping it a refusal costs this atlas
 * nothing and leaves the gate as strict as it can be.
 */
const REPORTED_LEAK_CLASSES: ReadonlyMap<string, string> = new Map([
  [
    "denylist",
    "a private denylist word appears — recorded, not refused, because this atlas's subject IS the organisation",
  ],
]);

/**
 * What this atlas declares about its own secrets.
 *
 * @internal
 */
export const NX_CLOUD_SENSITIVITY_POLICY: AtlasSensitivityPolicy = {
  forbiddenKeyParts: FORBIDDEN_KEY_PARTS,
  reportedLeakClasses: REPORTED_LEAK_CLASSES,
  valuePatterns: VALUE_PATTERNS,
};

/**
 * Split one key into the parts the forbidden set is matched against. Kit-owned.
 *
 * @param key the object key
 * @returns its lowercased parts
 *
 * @internal
 */
export function keyParts({ key }: { key: string }): readonly string[] {
  return atlasKeyParts({ key });
}

/**
 * Whether one key names a credential or a personal identifier this atlas never holds.
 *
 * @param key the object key
 * @returns `true` when any part, or the parts joined, is a forbidden word
 *
 * @internal
 */
export function isForbiddenKey({ key }: { key: string }): boolean {
  return isForbiddenAtlasKey({ key, policy: NX_CLOUD_SENSITIVITY_POLICY });
}

/**
 * Every sensitivity finding in one document, under this atlas's own policy.
 *
 * @param document the generation document about to be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @returns every finding, refusals and reports alike
 */
export function scanNxCloudSensitivity({
  document,
  denylist,
}: {
  document: unknown;
  denylist: readonly string[];
}): readonly NxCloudSensitivityFinding[] {
  return scanAtlasSensitivity({ denylist, document, policy: NX_CLOUD_SENSITIVITY_POLICY });
}

/**
 * Decide whether a document may be written.
 *
 * @param document the generation document about to be written
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param label what is being written, for the refusal message — e.g. `workspaces.json`
 * @returns the findings to record on success, or every reason the write is refused
 */
export function admitNxCloudDocument({
  document,
  denylist,
  label,
}: {
  document: unknown;
  denylist: readonly string[];
  label: string;
}): Result<readonly NxCloudSensitivityFinding[]> {
  return admitAtlasDocument({ denylist, document, label, policy: NX_CLOUD_SENSITIVITY_POLICY });
}
