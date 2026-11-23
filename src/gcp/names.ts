/**
 * The names the GCP door will put in a URL or a request body, each checked against the shape Google documents
 * for it before any request is built. Pure.
 *
 * A name is checked here rather than trusted because the door's whole rail is that a caller chooses an
 * OPERATION, never a path: a service id carrying `/` or `..`, or a member carrying a second role, would let a
 * caller reach a resource the operation never named. `request.ts` re-checks that URL normalisation did not move
 * a path after building it, so a shape this file lets through still cannot climb out of its collection.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";

/** A project id: 6–30 characters, lowercase letters, digits and hyphens, opening on a letter. */
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A region, `australia-southeast1` or `us-central1`. */
const REGION = /^[a-z]+(?:-[a-z]+)+\d{1,2}$/;

/** A Cloud Run service id: up to 49 characters, lowercase, opening on a letter and not ending on a hyphen. */
const RUN_SERVICE = /^[a-z](?:[-a-z0-9]{0,47}[a-z0-9])?$/;

/** A Secret Manager secret id. */
const SECRET = /^[A-Za-z0-9_-]{1,255}$/;

/** A secret version: a number, or the `latest` alias. */
const SECRET_VERSION = /^(?:latest|[1-9]\d{0,18})$/;

/** A service account id (the part before `@`), 6–30 characters. */
const ACCOUNT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A service account email: a user-managed account in a project, or a project's default compute account. */
const SERVICE_ACCOUNT_EMAIL =
  /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com|\d{1,20}-compute@developer\.gserviceaccount\.com)$/;

/** An email as an IAM member carries one. Deliberately narrow: no quotes, no spaces, no second `@`. */
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** A domain as a `domain:` member carries one. */
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** A predefined role, or a project's or organisation's custom role. */
const ROLE =
  /^(?:roles\/[A-Za-z0-9_.]{1,100}|projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/roles\/[A-Za-z0-9_.]{1,64}|organizations\/\d{1,20}\/roles\/[A-Za-z0-9_.]{1,64})$/;

/**
 * A container image the door deploys: an Artifact Registry or Container Registry path, pinned by tag or digest.
 * Anything else is refused rather than deployed — a public registry image is not what this door is for.
 */
const IMAGE =
  /^(?:[a-z0-9-]+-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9][a-z0-9-]{0,62}|(?:[a-z]+\.)?gcr\.io\/[a-z][a-z0-9-]{4,28}[a-z0-9])(?:\/[a-z0-9][a-z0-9._-]{0,127})+(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$/;

/** An environment variable name. */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;

/** A Google API service name, `run.googleapis.com`. */
const API_SERVICE = /^[a-z][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63})*\.googleapis\.com$/;

/** An Artifact Registry repository id. */
const REPOSITORY = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A free-text field (display name, description): printable, bounded, no control characters. */
const FREE_TEXT = /^[^\p{Cc}]{1,256}$/u;

/** Which name a check is about, so the refusal says what was wrong in the caller's own terms. */
export type GcpNameKind =
  | "project"
  | "region"
  | "run-service"
  | "secret"
  | "secret-version"
  | "account-id"
  | "service-account"
  | "role"
  | "image"
  | "env-key"
  | "api-service"
  | "repository"
  | "text";

/** The pattern each name kind must match, and the shape it names in a refusal. */
const PATTERNS: Readonly<Record<GcpNameKind, { readonly re: RegExp; readonly shape: string }>> = {
  "account-id": { re: ACCOUNT_ID, shape: "a service account id, 6–30 lowercase letters, digits and hyphens" },
  "api-service": { re: API_SERVICE, shape: "a Google API service name such as run.googleapis.com" },
  "env-key": { re: ENV_KEY, shape: "an environment variable name" },
  image: { re: IMAGE, shape: "an Artifact Registry or gcr.io image pinned by :tag or @sha256 digest" },
  project: { re: PROJECT, shape: "a GCP project id" },
  region: { re: REGION, shape: "a GCP region such as australia-southeast1" },
  repository: { re: REPOSITORY, shape: "an Artifact Registry repository id" },
  role: { re: ROLE, shape: "a predefined or custom IAM role such as roles/run.invoker" },
  "run-service": { re: RUN_SERVICE, shape: "a Cloud Run service id" },
  secret: { re: SECRET, shape: "a Secret Manager secret id" },
  "secret-version": { re: SECRET_VERSION, shape: "a secret version number, or latest" },
  "service-account": { re: SERVICE_ACCOUNT_EMAIL, shape: "a service account email" },
  text: { re: FREE_TEXT, shape: "printable text of at most 256 characters" },
};

/**
 * Check one name against the shape Google documents for its kind.
 *
 * @param kind which name this is
 * @param value what the caller passed
 * @returns the value unchanged, or `INPUT_INVALID` naming the shape it failed
 */
export function checkName({ kind, value }: { kind: GcpNameKind; value: string }): Result<string, GcpDoorError> {
  const pattern = PATTERNS[kind];
  if (!pattern.re.test(value)) {
    return err(GcpDoorErrors.inputInvalid({ why: `${JSON.stringify(value)} is not ${pattern.shape}` }));
  }
  return ok(value);
}

/** The members a public grant uses: anyone, or anyone signed in to Google. */
export const PUBLIC_MEMBERS: ReadonlySet<string> = new Set(["allUsers", "allAuthenticatedUsers"]);

/**
 * Check an IAM member: `user:`, `group:`, `serviceAccount:` with an email, `domain:` with a domain, or one of the
 * two public members.
 *
 * @param member what the caller passed
 * @returns the member unchanged, or `INPUT_INVALID`
 */
export function checkMember({ member }: { member: string }): Result<string, GcpDoorError> {
  if (PUBLIC_MEMBERS.has(member)) {
    return ok(member);
  }
  const colon = member.indexOf(":");
  const prefix = member.slice(0, colon);
  const rest = member.slice(colon + 1);
  const emailMember = (prefix === "user" || prefix === "group") && EMAIL.test(rest);
  const accountMember = prefix === "serviceAccount" && SERVICE_ACCOUNT_EMAIL.test(rest);
  const domainMember = prefix === "domain" && DOMAIN.test(rest);
  if (colon > 0 && (emailMember || accountMember || domainMember)) {
    return ok(member);
  }
  return err(
    GcpDoorErrors.inputInvalid({
      why:
        `${JSON.stringify(member)} is not an IAM member — write user:<email>, group:<email>, ` +
        "serviceAccount:<email>, domain:<domain>, allUsers or allAuthenticatedUsers",
    }),
  );
}
