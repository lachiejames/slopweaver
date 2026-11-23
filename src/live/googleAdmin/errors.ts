/**
 * The typed domain error for the Google Admin door — see `.claude/rules/error-handling.md` for the shape.
 * Its own union, shared with no other Google door: an Admin failure is an ORGANISATION-level failure, and
 * a caller genuinely branches on it differently from a mailbox or a file-store one.
 *
 * Today every variant comes from `../google/credentialErrors.js`, because today this door has exactly one
 * verb — `connect` — and every way it can fail is a way a GRANT fails. That is a statement about the
 * surface, not a sign the union is redundant: the door exists to be widened, and the first call that reads
 * an Admin API adds the variants nothing shared can emit (an API the Cloud project has not enabled answers
 * a 403 about the SERVICE, which is a different act to fix than a 403 about a scope). Declaring the union
 * here now is what keeps that widening a one-file change rather than a rename across every call site.
 */
import { type GoogleCredentialError, googleCredentialErrors } from "../google/credentialErrors.js";

/** Every failure a Google Admin door verb can produce. */
export type GoogleAdminDoorError = GoogleCredentialError;

/** Factories for every {@link GoogleAdminDoorError} variant — what real code and its tests both construct through. */
export const GoogleAdminDoorErrors = googleCredentialErrors({
  connectVerb: "slopweaver atlas google-admin connect",
  productName: "Google Workspace Admin",
});
