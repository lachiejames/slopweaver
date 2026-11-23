/**
 * The typed failures of building and publishing a 1Password atlas generation — `sync.ts`'s trust, lock,
 * denylist and README checks, `projection.ts`'s allowlist schema, `sensitivity.ts`'s pre-write gate and
 * `merge.ts`'s channel check.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside the `op` and Events API unions: nothing
 * here reaches a provider. A variant carrying `reasons` keeps one line per problem, and
 * {@link onepasswordSyncErrorLines} is how a caller prints them without re-composing the joined `message` —
 * a projection refusal's lines are counted downstream, so joining them would change what a gap publishes.
 *
 * A sensitivity refusal carries a path, a reason and a witness digest only, never the value it found; a
 * denylist failure carries the path and the error code, never a denylist line.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** Every way building or publishing a 1Password atlas generation can fail. */
export type OnepasswordSyncError =
  | (Listed<"GENERATION_UNTRUSTED"> & {
      readonly mismatched: readonly string[];
      readonly missing: readonly string[];
    })
  | Plain<"README_UNWRITABLE">
  | (Listed<"DENYLIST_UNREADABLE"> & { readonly path: string; readonly reason: string })
  | (Plain<"SYNC_LOCK_HELD"> & { readonly holder: string })
  | (Listed<"RECORD_REFUSED"> & { readonly kind: string })
  | (Listed<"DOCUMENT_REFUSED"> & { readonly label: string })
  | (Plain<"CHANNEL_EMPTY"> & { readonly entityId: string; readonly channel: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** A list of kinds for a sentence, `none` when there are none. */
function kindList({ kinds }: { kinds: readonly string[] }): string {
  const joined = kinds.join(", ");
  if (joined === "") {
    return "none";
  }
  return joined;
}

/** One schema issue as an indented line, `<root>` naming an issue about the record as a whole. */
function issueLine({ issue }: { issue: { readonly path: readonly PropertyKey[]; readonly message: string } }): string {
  const path = issue.path.map(String).join(".");
  if (path === "") {
    return `  <root>: ${issue.message}`;
  }
  return `  ${path}: ${issue.message}`;
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const OnepasswordSyncErrors = {
  channelEmpty: ({ entityId, channel }: { entityId: string; channel: string }): OnepasswordSyncError => ({
    channel,
    code: "CHANNEL_EMPTY",
    entityId,
    message: `entity ${entityId} was observed this run with no ${channel} channel populated`,
  }),
  denylistUnreadable: ({ path, reason }: { path: string; reason: string }): OnepasswordSyncError => ({
    ...listed({
      code: "DENYLIST_UNREADABLE",
      reasons: [
        `the private hygiene denylist at ${path} exists but could not be read (${reason})`,
        "refusing to sync rather than running the sensitivity gate with a denylist it never loaded",
      ],
    }),
    path,
    reason,
  }),
  documentRefused: ({
    label,
    refusals,
  }: {
    label: string;
    refusals: readonly { readonly path: string; readonly reason: string; readonly witness: string }[];
  }): OnepasswordSyncError => ({
    ...listed({
      code: "DOCUMENT_REFUSED",
      reasons: [
        `refusing to write ${label}: the sensitivity gate found ${String(refusals.length)} thing(s) that must never reach this atlas`,
        ...refusals.map((finding) => `  ${finding.path}: ${finding.reason} [witness ${finding.witness}]`),
        "nothing was written — the value itself is deliberately not printed above",
      ],
    }),
    label,
  }),
  generationUntrusted: ({
    mismatched,
    missing,
  }: {
    mismatched: readonly string[];
    missing: readonly string[];
  }): OnepasswordSyncError => ({
    ...listed({
      code: "GENERATION_UNTRUSTED",
      reasons: [
        `the current 1Password atlas generation disagrees with itself (mismatched: ${kindList({ kinds: mismatched })}; missing: ${kindList({ kinds: missing })})`,
        "refusing to merge against a generation this reader cannot trust",
        "run: slopweaver onepassword reset --confirm archive, then sync again",
      ],
    }),
    mismatched,
    missing,
  }),
  readmeUnwritable: ({ cause }: { cause: unknown }): OnepasswordSyncError => ({
    code: "README_UNWRITABLE",
    message: `the generation was published but its README could not be written: ${errorMessage({ error: cause })}`,
  }),
  recordRefused: ({
    kind,
    issues,
  }: {
    kind: string;
    issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
  }): OnepasswordSyncError => ({
    ...listed({
      code: "RECORD_REFUSED",
      reasons: [
        `a ${kind} record from 1Password does not match this atlas's allowlist schema`,
        ...issues.slice(0, 6).map((issue) => issueLine({ issue })),
        "refusing to project it rather than storing a half-understood record",
      ],
    }),
    kind,
  }),
  syncLockHeld: ({ holder }: { holder: string }): OnepasswordSyncError => ({
    code: "SYNC_LOCK_HELD",
    holder,
    message: `could not acquire the 1Password atlas sync lock: ${holder}`,
  }),
} as const;

/**
 * The lines one failure prints, exactly as the generation returned them before it had a type: a
 * list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function onepasswordSyncErrorLines({ error }: { error: OnepasswordSyncError }): readonly string[] {
  if (
    error.code === "GENERATION_UNTRUSTED" ||
    error.code === "DENYLIST_UNREADABLE" ||
    error.code === "RECORD_REFUSED" ||
    error.code === "DOCUMENT_REFUSED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
