/**
 * The typed failures of one Vanta atlas sync — the run itself (`sync.ts`), the channel merges (`merge.ts`),
 * policy documents and their presigned download (`policyDocuments.ts`, `documentDownload.ts`), the
 * sensitive companion files (`privacy.ts`) and the child fan-out (`syncChildren.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`. A sync failure's lines become a kind's published
 * reasons, so {@link vantaSyncErrorLines} is where a failure becomes exactly the lines it printed before it
 * had a type. The gap a surface failure opens is NOT read from these lines: it is graded from a typed code
 * in `surfaceErrors.ts` — credential absence included, at `sync.ts`'s `credentialsAbsentClient`, where it is
 * known rather than rediscovered from its sentence.
 *
 * No variant carries a presigned document URL: it holds its own signing credential in its query string, so
 * a download failure carries a status, a size or the caught cause, never the address.
 *
 * Pure: values in, values out.
 */
import type { OperationLockAcquireError } from "../../admit/operationLockHeld.js";
import { errorMessage } from "../../lib/errorMessage.js";
import type { VantaKind } from "./model.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A merge refusal naming the entity whose fresh channel was empty. */
interface EntityChannelError<C extends string> extends Plain<C> {
  readonly entityId: string;
}

/** A fan-out failure naming the child surface and the parent kind it fans out over. */
interface FanOutError<C extends string> extends Listed<C> {
  readonly surface: string;
  readonly parentKind: string;
}

/** Every way a Vanta atlas sync, merge, document store or child fan-out can fail. */
export type VantaSyncError =
  | (Listed<"GENERATION_UNTRUSTED"> & { readonly mismatched: readonly string[]; readonly missing: readonly string[] })
  | (Plain<"SYNC_LOCK_HELD"> & { readonly holder: string })
  | (Plain<"SURFACE_UNDECLARED"> & { readonly kind: VantaKind; readonly surface: string })
  | Plain<"CREDENTIALS_ABSENT">
  | EntityChannelError<"ENTITY_WITHOUT_API_CHANNEL">
  | EntityChannelError<"ENTITY_WITHOUT_BROWSER_CHANNEL">
  | (Listed<"POLICY_DOCUMENTS_UNSTORED"> & { readonly documentCount: number; readonly problems: readonly string[] })
  | (Plain<"DOCUMENT_HTTP_STATUS"> & { readonly status: number })
  | (Plain<"DOCUMENT_TOO_LARGE"> & { readonly byteLength: number; readonly cap: number })
  | (Plain<"DOCUMENT_UNFETCHABLE"> & { readonly cause: unknown })
  | (Plain<"COMPANION_UNWRITABLE"> & { readonly path: string; readonly cause: unknown })
  | (Plain<"CHILD_PARENT_FAILED"> & {
      readonly surface: string;
      readonly parentKind: string;
      readonly parentId: string;
      readonly upstream: readonly string[];
    })
  | (FanOutError<"CHILD_SURFACE_ABSENT"> & {
      readonly asked: number;
      readonly refused: readonly { readonly parentId: string; readonly reason: string }[];
    })
  | (FanOutError<"PARENT_FAN_OUT_REFUSED"> & { readonly parentReasons: readonly string[] | null });

/** The kinds a generation check names, or `none` when the list is empty — kind names are never empty. */
function kindList({ kinds }: { kinds: readonly string[] }): string {
  if (kinds.length === 0) {
    return "none";
  }
  return kinds.join(", ");
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VantaSyncErrors = {
  childParentFailed: ({
    surface,
    parentKind,
    parentId,
    upstream,
  }: {
    surface: string;
    parentKind: string;
    parentId: string;
    upstream: readonly string[];
  }): VantaSyncError => ({
    code: "CHILD_PARENT_FAILED",
    message: `${surface} for ${parentKind} ${parentId}: ${upstream.join("; ")}`,
    parentId,
    parentKind,
    surface,
    upstream,
  }),
  childSurfaceAbsent: ({
    surface,
    parentKind,
    asked,
    refused,
  }: {
    surface: string;
    parentKind: string;
    asked: number;
    refused: readonly { readonly parentId: string; readonly reason: string }[];
  }): VantaSyncError => {
    const reasons = [
      `every one of the ${String(asked)} ${parentKind}(s) refused ${surface} — a surface no parent can serve is an absent surface, not an empty one`,
      ...refused.slice(0, 3).map((refusal) => `  ${refusal.parentId}: ${refusal.reason}`),
    ];
    return { asked, code: "CHILD_SURFACE_ABSENT", message: reasons.join("; "), parentKind, reasons, refused, surface };
  },
  companionUnwritable: ({ path, cause }: { path: string; cause: unknown }): VantaSyncError => ({
    cause,
    code: "COMPANION_UNWRITABLE",
    message: `cannot write the sensitive companion file at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  credentialsAbsent: (): VantaSyncError => ({
    code: "CREDENTIALS_ABSENT",
    message:
      "Vanta credentials are not configured — export VANTA_CLIENT_ID and VANTA_CLIENT_SECRET, or run `slopweaver secrets set vanta-client-id` and `vanta-client-secret` (see atlas/vanta/credentialFiles.ts)",
  }),
  documentHttpStatus: ({ status }: { status: number }): VantaSyncError => ({
    code: "DOCUMENT_HTTP_STATUS",
    message: `the presigned document URL answered HTTP ${String(status)}`,
    status,
  }),
  documentTooLarge: ({ byteLength, cap }: { byteLength: number; cap: number }): VantaSyncError => ({
    byteLength,
    cap,
    code: "DOCUMENT_TOO_LARGE",
    message: `the presigned document is ${String(byteLength)} bytes, past the ${String(cap)}-byte cap this reader will hold in memory`,
  }),
  documentUnfetchable: ({ cause }: { cause: unknown }): VantaSyncError => ({
    cause,
    code: "DOCUMENT_UNFETCHABLE",
    message: `could not fetch the presigned document: ${errorMessage({ error: cause })}`,
  }),
  entityWithoutApiChannel: ({ entityId }: { entityId: string }): VantaSyncError => ({
    code: "ENTITY_WITHOUT_API_CHANNEL",
    entityId,
    message: `entity ${entityId} was observed this run with no manage-api channel populated`,
  }),
  entityWithoutBrowserChannel: ({ entityId }: { entityId: string }): VantaSyncError => ({
    code: "ENTITY_WITHOUT_BROWSER_CHANNEL",
    entityId,
    message: `entity ${entityId} was captured this run with no browser channel populated`,
  }),
  generationUntrusted: ({
    mismatched,
    missing,
  }: {
    mismatched: readonly string[];
    missing: readonly string[];
  }): VantaSyncError => {
    const reasons = [
      `the current Vanta atlas generation disagrees with itself (mismatched: ${kindList({ kinds: mismatched })}; missing: ${kindList({ kinds: missing })})`,
      "refusing to merge against a generation this reader cannot trust",
      "run: slopweaver atlas vanta reset --confirm archive, then sync again",
    ];
    return { code: "GENERATION_UNTRUSTED", message: reasons.join("; "), mismatched, missing, reasons };
  },
  parentFanOutRefused: ({
    surface,
    parentKind,
    parentReasons,
  }: {
    surface: string;
    parentKind: string;
    parentReasons: readonly string[] | null;
  }): VantaSyncError => {
    let because: readonly string[] = [`${parentKind} was not read at all this run`];
    if (parentReasons !== null) {
      because = parentReasons;
    }
    const reasons = [
      `${surface} cannot be fanned out over ${parentKind}, which did not read completely this run — a partial fan-out would read as a tenant with fewer children than it has`,
      ...because,
    ];
    return { code: "PARENT_FAN_OUT_REFUSED", message: reasons.join("; "), parentKind, parentReasons, reasons, surface };
  },
  policyDocumentsUnstored: ({
    documentCount,
    problems,
  }: {
    documentCount: number;
    problems: readonly string[];
  }): VantaSyncError => {
    const reasons = [
      `${String(problems.length)} of ${String(documentCount)} policy document(s) could not be stored whole`,
      ...problems,
    ];
    return { code: "POLICY_DOCUMENTS_UNSTORED", documentCount, message: reasons.join("; "), problems, reasons };
  },
  surfaceUndeclared: ({ kind, surface }: { kind: VantaKind; surface: string }): VantaSyncError => ({
    code: "SURFACE_UNDECLARED",
    kind,
    message: `Vanta kind ${kind} declares no manage-api surface ${surface} in the inventory, so its evidence grade is unknown and the read is refused rather than graded authoritative`,
    surface,
  }),
  syncLockHeld: ({ holder }: { holder: string }): VantaSyncError => ({
    code: "SYNC_LOCK_HELD",
    holder,
    message: `could not acquire the Vanta atlas sync lock: ${holder}`,
  }),
} as const;

/**
 * Why one whole sync RUN produced no report, as its verb's exit code needs it: `SYNC_CONTENDED` when a live
 * holder had the sync lock, so running again unchanged is correct (exit 4), and `SYNC_REFUSED` for everything
 * else (exit 1). `lines` are exactly what the run printed before the split had a type.
 */
export type VantaSyncRunError =
  | { readonly code: "SYNC_CONTENDED"; readonly message: string; readonly lines: readonly string[] }
  | { readonly code: "SYNC_REFUSED"; readonly message: string; readonly lines: readonly string[] };

/** How to raise one. */
export const VantaSyncRunErrors = {
  contended: ({ lines }: { lines: readonly string[] }): VantaSyncRunError => ({
    code: "SYNC_CONTENDED",
    lines,
    message: lines.join("; "),
  }),
  refused: ({ lines }: { lines: readonly string[] }): VantaSyncRunError => ({
    code: "SYNC_REFUSED",
    lines,
    message: lines.join("; "),
  }),
  /**
   * The sync lock was not taken. MEASURED: the scheduled `resync-atlas-vanta` slot met a live sync
   * and exited 1, which held the recipe and seated a p0 repair; a live holder is "not yet", so only
   * `LOCK_CONTENDED` becomes `SYNC_CONTENDED` and gives the slot back.
   */
  lockNotTaken: ({ error }: { error: OperationLockAcquireError }): VantaSyncRunError => {
    const lines = vantaSyncErrorLines({ error: VantaSyncErrors.syncLockHeld({ holder: error.message }) });
    if (error.code === "LOCK_CONTENDED") {
      return VantaSyncRunErrors.contended({ lines });
    }
    return VantaSyncRunErrors.refused({ lines });
  },
} as const;

/**
 * The lines one failure prints, exactly as the sync printed them before it had a type: a list-carrying
 * failure as its list, and every other failure as its one message. `CHILD_PARENT_FAILED` is deliberately
 * one line — the parent's own reasons joined into it, as the fan-out always reported them.
 *
 * @returns the lines, in order
 */
export function vantaSyncErrorLines({ error }: { error: VantaSyncError }): readonly string[] {
  if (
    error.code === "GENERATION_UNTRUSTED" ||
    error.code === "POLICY_DOCUMENTS_UNSTORED" ||
    error.code === "CHILD_SURFACE_ABSENT" ||
    error.code === "PARENT_FAN_OUT_REFUSED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
