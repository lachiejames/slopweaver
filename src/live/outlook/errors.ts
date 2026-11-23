/**
 * The typed domain error for every Outlook door verb — see `.claude/rules/error-handling.md` for the shape.
 * Its own union, shared with no other provider: an Outlook failure is a Microsoft mailbox failure, and its
 * grant is MSAL's serialized cache rather than a Google refresh token, so even the grant-lifecycle variants are
 * this door's own rather than `../google/credentialErrors.ts`'s, whose producing code it never runs.
 */
import type { BoundaryError } from "#lib/boundary.js";

import { outlookReconnectCommand } from "./scopes.js";

/** No grant is stored for the selected state home — nothing has been authorised yet. */
interface NotConnectedError {
  readonly code: "NOT_CONNECTED";
  readonly message: string;
}

/** A grant exists but does not carry a scope this verb needs. */
interface ScopeMissingError {
  readonly code: "SCOPE_MISSING";
  readonly message: string;
  readonly missing: readonly string[];
}

/** The grant could not be read or written back, or no client id is configured. */
interface CredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly cause?: unknown;
}

/** Another outlook verb held the grant's refresh lock for the whole wait; nothing was refreshed or read. */
interface GrantBusyError {
  readonly code: "GRANT_BUSY";
  readonly message: string;
}

/** The consent round trip failed — declined, a foreign state, or a refused exchange. */
interface ConsentFailedError {
  readonly code: "CONSENT_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Microsoft will not refresh silently any more — the refresh token expired or was revoked. */
interface InteractionRequiredError {
  readonly code: "INTERACTION_REQUIRED";
  readonly message: string;
  readonly cause?: unknown;
}

/** A Graph or sign-in call failed: network, throttling, a refusal. `status` is Graph's HTTP status when known. */
interface ApiFailedError {
  readonly code: "API_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Graph answered a shape the boundary does not declare; `drift` names every key that moved. */
interface ResponseShapeChangedError {
  readonly code: "RESPONSE_SHAPE_CHANGED";
  readonly message: string;
  readonly operation: string;
}

/** Graph answered as a success but left out a field this verb cannot act without. */
interface ResponseFieldMissingError {
  readonly code: "RESPONSE_FIELD_MISSING";
  readonly message: string;
  readonly operation: string;
  readonly field: string;
}

/** Graph refused a `$filter` as too expensive. Never answered with a weaker query — the residue is the read. */
interface InefficientFilterError {
  readonly code: "INEFFICIENT_FILTER";
  readonly message: string;
  readonly filter: string;
}

/** A paging link pointed somewhere other than Graph, so it was not followed with the owner's bearer. */
interface NextLinkRefusedError {
  readonly code: "NEXT_LINK_REFUSED";
  readonly message: string;
}

/** A whole collection (attachments, categories) was still paging at the ceiling, so no answer was drawn from part of it. */
interface CollectionIncompleteError {
  readonly code: "COLLECTION_INCOMPLETE";
  readonly message: string;
  readonly operation: string;
}

/** A write that is never retried failed in a way that does not say whether Graph performed it. */
interface WriteOutcomeUnknownError {
  readonly code: "WRITE_OUTCOME_UNKNOWN";
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown;
}

/** A folder or category reference matched nothing, or more than one thing. */
interface ReferenceUnresolvedError {
  readonly code: "REFERENCE_UNRESOLVED";
  readonly message: string;
  readonly candidates: readonly string[];
}

/** No attachment, or more than one, matched the selector. */
interface AttachmentUnresolvedError {
  readonly code: "ATTACHMENT_UNRESOLVED";
  readonly message: string;
  readonly candidates: readonly string[];
}

/** The attachment is an Outlook item or a cloud link, which have no file bytes to save. */
interface AttachmentKindUnsupportedError {
  readonly code: "ATTACHMENT_KIND_UNSUPPORTED";
  readonly message: string;
  readonly kind: string;
}

/** The attachment is over the caller's ceiling, refused before any bytes were fetched. */
interface AttachmentTooLargeError {
  readonly code: "ATTACHMENT_TOO_LARGE";
  readonly message: string;
  readonly sizeBytes: number;
  readonly maxBytes: number;
}

/** The local destination for an attachment is not a usable, contained directory. */
interface DestinationUnusableError {
  readonly code: "DESTINATION_UNUSABLE";
  readonly message: string;
}

/** One category was asked for in both directions, after ids and names resolved to the same display name. */
interface CategoryConflictError {
  readonly code: "CATEGORY_CONFLICT";
  readonly message: string;
  readonly names: readonly string[];
}

/** A draft verb was pointed at something that is not a draft, or a send at a draft whose digest moved. */
interface DraftRefusedError {
  readonly code: "DRAFT_REFUSED";
  readonly message: string;
}

/** Every failure an Outlook door verb can produce. */
export type OutlookError =
  | NotConnectedError
  | ScopeMissingError
  | CredentialUnreadableError
  | GrantBusyError
  | ConsentFailedError
  | InteractionRequiredError
  | ApiFailedError
  | ResponseShapeChangedError
  | ResponseFieldMissingError
  | InefficientFilterError
  | NextLinkRefusedError
  | CollectionIncompleteError
  | WriteOutcomeUnknownError
  | ReferenceUnresolvedError
  | AttachmentUnresolvedError
  | AttachmentKindUnsupportedError
  | AttachmentTooLargeError
  | DestinationUnusableError
  | CategoryConflictError
  | DraftRefusedError;

/** The verb that establishes or widens the grant, named by every refusal that needs it. */
const CONNECT_VERB = "slopweaver outlook connect";

/** Factories for every {@link OutlookError} variant — the shape real code and its tests both construct through. */
export const OutlookErrors = {
  apiFailed: ({ message, cause }: { message: string; cause?: unknown }): ApiFailedError => ({
    code: "API_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),
  attachmentKindUnsupported: ({ kind, name }: { kind: string; name: string }): AttachmentKindUnsupportedError => ({
    code: "ATTACHMENT_KIND_UNSUPPORTED",
    kind,
    message:
      `"${name}" is an ${kind}, not a file — an attached Outlook item or a cloud link has no bytes to save here; ` +
      "open it in Outlook",
  }),
  attachmentTooLarge: ({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }): AttachmentTooLargeError => ({
    code: "ATTACHMENT_TOO_LARGE",
    maxBytes,
    message:
      `the attachment is ${String(sizeBytes)} bytes, over the ${String(maxBytes)}-byte ceiling; nothing was ` +
      "fetched — raise --max-file-mb to take it",
    sizeBytes,
  }),
  attachmentUnresolved: ({
    selector,
    candidates,
    ambiguous,
  }: {
    selector: string;
    candidates: readonly string[];
    ambiguous: boolean;
  }): AttachmentUnresolvedError => {
    let message = `no attachment matches ${selector}: this message carries no attachments`;
    if (ambiguous) {
      message = `${String(candidates.length)} attachments match ${selector}; add --attachment-id to pick one: ${candidates.join("; ")}`;
    } else if (candidates.length > 0) {
      message = `no attachment matches ${selector}; the message carries: ${candidates.join("; ")}`;
    }
    return { candidates, code: "ATTACHMENT_UNRESOLVED", message };
  },
  boundary: ({ error, operation }: { error: BoundaryError; operation: string }): ResponseShapeChangedError => ({
    code: "RESPONSE_SHAPE_CHANGED",
    message: `Graph answered ${operation} in a shape this door does not declare — ${error.message}`,
    operation,
  }),
  categoryConflict: ({ names }: { names: readonly string[] }): CategoryConflictError => ({
    code: "CATEGORY_CONFLICT",
    message: `${names.join(", ")} is both added and removed — give each category one direction`,
    names,
  }),
  collectionIncomplete: ({ operation, pages }: { operation: string; pages: number }): CollectionIncompleteError => ({
    code: "COLLECTION_INCOMPLETE",
    message:
      `Graph was still paging ${operation} after ${String(pages)} pages, so nothing was matched against part of ` +
      "the list",
    operation,
  }),
  consentFailed: ({ message, cause }: { message: string; cause?: unknown }): ConsentFailedError => ({
    code: "CONSENT_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),
  credentialUnreadable: ({ message, cause }: { message: string; cause?: unknown }): CredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),
  destinationUnusable: ({
    destination,
    reason,
  }: {
    destination: string;
    reason: string;
  }): DestinationUnusableError => ({
    code: "DESTINATION_UNUSABLE",
    message: `cannot write the attachment under ${destination}: ${reason}`,
  }),
  draftRefused: ({ message }: { message: string }): DraftRefusedError => ({ code: "DRAFT_REFUSED", message }),
  grantBusy: ({ holder }: { holder: string }): GrantBusyError => ({
    code: "GRANT_BUSY",
    message: `another outlook verb is still refreshing the grant, so this one did nothing — run it again once that finishes (${holder})`,
  }),
  inefficientFilter: ({ filter }: { filter: string }): InefficientFilterError => ({
    code: "INEFFICIENT_FILTER",
    filter,
    message:
      `Graph refused the filter \`${filter}\` as too expensive for this mailbox (InefficientFilter); nothing was ` +
      "read, and no weaker query was tried in its place",
  }),
  interactionRequired: ({ cause }: { cause?: unknown }): InteractionRequiredError => ({
    code: "INTERACTION_REQUIRED",
    message: `Microsoft will not refresh this grant silently any more — run \`${CONNECT_VERB}\` again`,
    ...(cause !== undefined ? { cause } : {}),
  }),
  nextLinkRefused: ({ link }: { link: string }): NextLinkRefusedError => ({
    code: "NEXT_LINK_REFUSED",
    message: `Graph's paging link does not point at https://graph.microsoft.com, so it was not followed: ${link}`,
  }),
  notConnected: (): NotConnectedError => ({
    code: "NOT_CONNECTED",
    message: `no Outlook grant stored for this home — run \`${CONNECT_VERB}\``,
  }),
  referenceUnresolved: ({
    kind,
    reference,
    candidates,
  }: {
    kind: "folder" | "category";
    reference: string;
    candidates: readonly string[];
  }): ReferenceUnresolvedError => ({
    candidates,
    code: "REFERENCE_UNRESOLVED",
    message:
      candidates.length > 1
        ? `${String(candidates.length)} ${kind}s match "${reference}" — name one by id: ${candidates.join("; ")}`
        : `no ${kind} matches "${reference}" — \`slopweaver outlook ${kind === "folder" ? "folders" : "categories"}\` lists them`,
  }),
  responseFieldMissing: ({ operation, field }: { operation: string; field: string }): ResponseFieldMissingError => ({
    code: "RESPONSE_FIELD_MISSING",
    field,
    message: `Graph answered ${operation} with no \`${field}\`, which this verb cannot act without; nothing was done with it`,
    operation,
  }),
  // `granted` is what the stored grant already holds, so the command named re-grants the missing permission
  // without dropping one the owner had — `outlookReconnectCommand` carries the rule.
  scopeMissing: ({
    missing,
    granted,
  }: {
    missing: readonly string[];
    granted: readonly string[];
  }): ScopeMissingError => ({
    code: "SCOPE_MISSING",
    message: `the stored Outlook grant is missing ${missing.join(", ")} — re-run \`${outlookReconnectCommand({ granted, missing })}\` and approve it`,
    missing,
  }),
  writeOutcomeUnknown: ({
    operation,
    detail,
    check,
    cause,
  }: {
    operation: string;
    detail: string;
    check: string;
    cause?: unknown;
  }): WriteOutcomeUnknownError => ({
    code: "WRITE_OUTCOME_UNKNOWN",
    message: `${operation} did not report back cleanly (${detail}), so it may have happened — check ${check} before running it again`,
    operation,
    ...(cause !== undefined ? { cause } : {}),
  }),
} as const;
