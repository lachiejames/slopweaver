/**
 * Shared builders for the WorkOS atlas's unit tests.
 *
 * Every body here is the one the real server returned — MEASURED against `api.workos.com` with
 * no credential at all. Reproduce any of them with `slopweaver atlas workos sync --json` and read
 * `statusCode` beside `verdict`; the classifier under test is what turns one into the other.
 */
import type { WorkosProbeResponse } from "../../../../atlas/workos/routeProbe.js";

/** A fixed instant, so every assertion in these files is exact. */
export const AT = "2026-09-05T00:00:00.000Z";

/**
 * A synthetic WorkOS environment segment, shaped like the real thing and belonging to no installation.
 *
 * The real one is per-install state resolved from `$SLOPWEAVER_HOME` (`atlas/workos/environmentId.ts`), and
 * the hygiene gate refuses an environment id only when a hashed rule matches it and `IDENTIFIER_VERDICT` reads
 * `refuse` — so keeping a real one out of the tree is judgement rather than a gate, and the judgement is made
 * once, here.
 */
export const TEST_ENVIRONMENT_ID = "environment_01TESTTESTTESTTESTTESTTEST";

/**
 * `401 {"message":"Unauthorized"}` — the ordinary REST refusal, and proof the route is routed.
 *
 * @returns the response to classify
 */
export function unauthorized(): WorkosProbeResponse {
  return { status: 401, text: '{"message":"Unauthorized"}' };
}

/**
 * `401 {"error":"unauthenticated"}` — the Vault service's own vocabulary on the same host.
 *
 * @returns the response to classify
 */
export function foreignUnauthenticated(): WorkosProbeResponse {
  return { status: 401, text: '{"error":"unauthenticated"}' };
}

/**
 * `422` from `POST /sso/token`, carrying the four parameter names it wanted.
 *
 * @returns the response to classify
 */
export function validationFailed(): WorkosProbeResponse {
  return {
    status: 422,
    text: JSON.stringify({
      errors: [
        { code: "client_id must be a string", field: "client_id" },
        { code: "client_secret must be a string", field: "client_secret" },
        { code: "code must be a string", field: "code" },
        { code: "grant_type must be a string", field: "grant_type" },
      ],
      message: "Validation failed",
    }),
  };
}

/**
 * `400` from `POST /user_management/authenticate`, naming one parameter in prose.
 *
 * @returns the response to classify
 */
export function oauthInvalidRequest(): WorkosProbeResponse {
  return {
    status: 400,
    text: JSON.stringify({ error: "invalid_request", error_description: "Missing required parameter: client_id." }),
  };
}

/**
 * `404` from `GET /sso/jwks/{client_id}` — the ROUTE ran and the entity is what is missing.
 *
 * @returns the response to classify
 */
export function entityNotFound(): WorkosProbeResponse {
  return {
    status: 404,
    text: JSON.stringify({ code: "entity_not_found", entity_id: "client_x", message: "Application not found." }),
  };
}

/**
 * `404` under a non-GET method for a pair the API does not route.
 *
 * @returns the response to classify, echoing the pair back the way the server does
 */
export function cannotMethod({ method, path }: { method: string; path: string }): WorkosProbeResponse {
  return { status: 404, text: JSON.stringify({ error: "Not Found", message: `Cannot ${method} ${path}` }) };
}

/**
 * `404` under GET for a path the API does not know — the generic shape.
 *
 * @returns the response to classify
 */
export function genericNotFound(): WorkosProbeResponse {
  return { status: 404, text: JSON.stringify({ error: "Not Found", message: "The requested resource was not found" }) };
}

/**
 * `302` to the vendor's error host — a browser-facing entry point that redirects rather than answering.
 *
 * @returns the response to classify
 */
export function redirected(): WorkosProbeResponse {
  return { status: 302, text: "Found. Redirecting to https://error.workos.com/sso" };
}
