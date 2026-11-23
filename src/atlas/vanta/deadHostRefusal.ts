/**
 * The Vanta Manage transport's half of the dead-Datadog-host refusal (`../../outbound/invalidDatadogHost.ts`).
 *
 * Its own module so the transport stays one call wide at the seam. A write is judged on its path and body before
 * it is paced, sent or retried; a `GET` is a read and passes. Headers are never judged: they carry the bearer
 * token, never content. A multipart body's files are `Blob`s, which the synchronous payload walk cannot read, so
 * their bytes are read here first, so an evidence upload's file never reaches `fetch` unjudged.
 */
import { invalidDatadogHostRefusalLines } from "../../outbound/invalidDatadogHost.js";
import type { VantaDraftEditPlan } from "./policyDraft.js";
import type { VantaRequestInit } from "./transport.js";

/**
 * The refusal for one Vanta request, or `undefined` to send it.
 *
 * @param requestInit the request about to be sent
 * @param safePath the request path with any secret redacted, for the refusal's first line
 * @returns the four refusal lines, or `undefined` when the request is a read or carries no dead host. A request
 *   declaring `sensitiveValues` is judged the same, but its refusal names neither the host it found nor the
 *   path, since either could carry one of those values
 */
export async function vantaDeadHostRefusal({
  requestInit,
  safePath,
}: {
  requestInit: VantaRequestInit;
  safePath: string;
}): Promise<readonly string[] | undefined> {
  if (requestInit.method === "GET") {
    return undefined;
  }
  const files: Uint8Array[] = [];
  if (requestInit.body instanceof FormData) {
    for (const entry of requestInit.body.values()) {
      if (entry instanceof Blob) {
        files.push(new Uint8Array(await entry.arrayBuffer()));
      }
    }
  }
  const withholdHits = requestInit.sensitiveValues !== undefined && requestInit.sensitiveValues.length > 0;
  // The path is part of what was scanned, so a withheld refusal names no path either.
  const command = withholdHits ? `vanta ${requestInit.method}` : `vanta ${requestInit.method} ${safePath}`;
  return invalidDatadogHostRefusalLines({
    command,
    payload: { body: requestInit.body, files, path: requestInit.path },
    withholdHits,
  });
}

/**
 * The refusal for one browser-driven draft edit, or `undefined` to type it.
 *
 * The browser types only `replace`, but Vanta's editor then saves the WHOLE document, so the text judged is the
 * replacement and the document it produces (an unrelated edit would otherwise re-save a dead host already in
 * the draft). `find` is not judged, because an edit whose `find` carries the dead host is the one that removes it.
 *
 * @param plan the substitution about to be typed, with the editor text it must produce
 * @returns the four refusal lines, or `undefined` when neither the replacement nor the result carries a dead host
 */
export function vantaDraftEditDeadHostRefusal({
  plan,
}: {
  plan: Pick<VantaDraftEditPlan, "expectedText" | "replace">;
}): readonly string[] | undefined {
  return invalidDatadogHostRefusalLines({
    command: "slopweaver write vanta edit-policy-draft",
    payload: { expectedText: plan.expectedText, replace: plan.replace },
  });
}

/**
 * The refusal for one browser-driven policy-version upload, or `undefined` to render and attach it.
 *
 * The PDF is bytes no transport reads as text, so its markdown SOURCE is judged, and the policy id with it: the
 * id names the PDF file the browser attaches.
 *
 * @param markdown the policy text the PDF is rendered from
 * @param policyId the Vanta policy whose new version this is, which the attached file is named after
 * @returns the four refusal lines, or `undefined` when neither carries a dead host
 */
export function vantaPolicyUploadDeadHostRefusal({
  markdown,
  policyId,
}: {
  markdown: string;
  policyId: string;
}): readonly string[] | undefined {
  return invalidDatadogHostRefusalLines({
    command: "slopweaver write vanta upload-policy-version",
    payload: { markdown, policyId },
  });
}
