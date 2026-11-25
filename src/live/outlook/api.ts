/**
 * The production Outlook seam: the read, paged and write method sets assembled over one bound Graph client.
 * The interface, its shapes and the three properties every request has are in `apiCore.ts`.
 */
import { scopeIdForToken } from "#lib/providerCall.js";
import type { OutlookApi } from "./apiCore.js";
import { deltaMethods } from "./apiDelta.js";
import { pagedMethods } from "./apiPaged.js";
import { readMethods } from "./apiRead.js";
import { writeMethods } from "./apiWrite.js";
import type { GraphClient } from "./client.js";

/**
 * Build the production seam over one bound Graph client.
 *
 * @param graph the client `session.ts` bound to the grant
 * @param rateScopeKey what the shared 429 block counts against: the bound mailbox, or at consent time — before
 *   any mailbox is known — the app's client id, as the Google consent does
 * @returns the {@link OutlookApi} every verb calls
 */
export function makeOutlookApi({ graph, rateScopeKey }: { graph: GraphClient; rateScopeKey: string }): OutlookApi {
  const scopeId = scopeIdForToken({ token: rateScopeKey });
  return {
    ...readMethods({ graph, scopeId }),
    ...pagedMethods({ graph, scopeId }),
    ...deltaMethods({ graph, scopeId }),
    ...writeMethods({ graph, scopeId }),
  };
}
