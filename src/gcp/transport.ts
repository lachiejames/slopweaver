/**
 * The GCP door's sender over the owner's Application Default Credential, and the one read of an answer through its
 * strict boundary.
 *
 * A READ is retried on a transient failure; a WRITE is sent exactly once, with the library's own retry off as
 * well, because a create or a version add that timed out has an outcome nobody knows and a second send could
 * make a second resource. A 404 is its own error, since the planner branches on "does this exist". A failed
 * call's detail is Google's message with the request's secret payload, when it carried one, cut out of it.
 *
 * Every call carries `x-goog-user-project` set to the project it acts on, so its quota and billing land there.
 */
import type { GoogleAuth } from "googleapis-common";

import { unsetFieldAsNull } from "#lib/absent.js";
import type { Boundary } from "#lib/boundary.js";
import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { cutValues, literalEnvValues, type UnprintableValue } from "./redact.js";
import { buildGcpDoorRequest, type GcpDoorRequest } from "./request.js";

/** The send seam, injectable so every shell above it is tested with a plain fake. */
export type GcpDoorSend = (args: { request: GcpDoorRequest }) => Promise<Result<unknown, GcpDoorError>>;

/** Every value a request carries that must never be printed: a secret payload, or a template's literal env values. */
function unprintableValues({ request }: { request: GcpDoorRequest }): readonly UnprintableValue[] {
  if (request.kind === "secret-version-add") {
    return [{ label: "<payload>", value: request.data }];
  }
  if (request.kind === "run-service-create" || request.kind === "run-service-patch") {
    return literalEnvValues({ template: request.template });
  }
  return [];
}

/**
 * A failed call's detail with every value the request carried that must never be printed cut out of it — a
 * version add's payload, and every literal env value of a deploy's template, since a deploy carries the
 * service's existing env forward verbatim — so Google quoting the body back cannot put one on stderr.
 *
 * @param request the call that failed
 * @param detail what the transport said
 * @returns the detail, safe to print
 */
export function redactedDetail({ request, detail }: { request: GcpDoorRequest; detail: string }): string {
  return cutValues({ text: detail, values: unprintableValues({ request }) });
}

/**
 * Build a sender over the owner's Application Default Credential, billing every call to `quotaProject`.
 *
 * @param auth a fresh `GoogleAuth` over the cloud-platform scope
 * @param quotaProject the project every call's quota and billing land on
 * @returns the sender: a read transiently retried, a write sent once, the body untyped until a boundary reads it
 */
export function gcpDoorSender({ auth, quotaProject }: { auth: GoogleAuth; quotaProject: string }): GcpDoorSend {
  return async ({ request }) => {
    const built = buildGcpDoorRequest({ request });
    if (built.isErr()) {
      return err(built.error);
    }
    const { body, effect, method, operation, url } = built.value;
    const answered = await safeProviderCall({
      execute: async () => {
        const options = {
          ...(body === undefined ? {} : { data: body }),
          method,
          redirect: "error",
          retry: false,
          url,
        } as const;
        if (effect === "read") {
          return auth.request<unknown>({ ...options, headers: { "x-goog-user-project": quotaProject } });
        }
        // A write never goes through the auth client's own `request`: every client in google-auth-library 11.2.0
        // re-sends once on a 401/403 under some credential state (`requestAsync(opts, true)` in oauth2client.js
        // with no expiry_date, baseexternalclient.js under forceRefreshOnFailure). Its headers are fetched once
        // and the body goes out through the client's plain transporter, which has no such branch.
        const client = await auth.getClient();
        const headers = new Headers(await client.getRequestHeaders(url));
        headers.set("x-goog-user-project", quotaProject);
        return client.transporter.request<unknown>({ ...options, headers });
      },
      operation,
      provider: "gcp",
      retryMode: effect === "write" ? "never" : "transient",
      scopeId: quotaProject,
    });
    if (answered.isErr()) {
      const status = unsetFieldAsNull({ key: "status", record: answered.error });
      if (status === 404) {
        return err(GcpDoorErrors.notFound({ operation }));
      }
      return err(
        GcpDoorErrors.transportFailed({
          detail: redactedDetail({ detail: answered.error.message, request }),
          operation,
          status,
        }),
      );
    }
    return ok(answered.value.data);
  };
}

/**
 * Send one request and read its answer through the endpoint's strict boundary.
 *
 * @param send the sender
 * @param request the call
 * @param boundary the endpoint's declared answer
 * @returns the typed answer, the send's own error, or `RESPONSE_CHANGED` naming the drift
 */
export async function callGcp<T>({
  send,
  request,
  boundary,
}: {
  send: GcpDoorSend;
  request: GcpDoorRequest;
  boundary: Boundary<T>;
}): Promise<Result<T, GcpDoorError>> {
  const answered = await send({ request });
  if (answered.isErr()) {
    return err(answered.error);
  }
  // A validation failure names the answer's own keys and paths, and an answer that carries an unprintable value
  // has nothing stopping one of those equalling it — so that detail is withheld, never cut against a value the
  // boundary has not yet read.
  const withheld = answerCarriesUnprintable({ request });
  return boundary.parse({ value: answered.value }).mapErr((error) =>
    GcpDoorErrors.responseChanged({
      detail: withheld ? "detail withheld: this answer carries values the door never prints" : error.message,
      endpoint: boundary.endpoint,
    }),
  );
}

/** Whether a request's ANSWER carries a value the door never prints: an accessed payload, or a service's env. */
function answerCarriesUnprintable({ request }: { request: GcpDoorRequest }): boolean {
  switch (request.kind) {
    case "secret-version-access":
    case "run-service-get":
    case "run-service-create":
    case "run-service-patch":
      return true;
    case "operation-get":
      return request.provider === "run";
    case "run-iam-get":
    case "run-iam-set":
    case "secret-get":
    case "secret-create":
    case "secret-version-list":
    case "secret-version-add":
    case "secret-version-disable":
    case "secret-version-get":
    case "secret-iam-get":
    case "secret-iam-set":
    case "service-account-get":
    case "service-account-create":
    case "api-service-get":
    case "api-service-enable":
    case "repository-get":
    case "repository-create":
      return false;
  }
}
