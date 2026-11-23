/**
 * Linear asset bytes — the effectful half of `linear read --pdf`, and the second place in this program
 * that performs a raw authenticated HTTP GET.
 *
 * ## Why it is not an SDK call
 *
 * The Linear SDK's surface is GraphQL. An asset lives behind the `assetUrl` that `mutation.fileUpload`
 * reserved (`../../corpus/linear/writeAssets.ts`), and nothing in the SDK will fetch one. So, exactly as
 * `../slack/download.ts` argues for its own GET, the house rule "official SDK, never ad-hoc transport"
 * cannot be met literally here; what it CAN be held to is that the call still goes through
 * `safeProviderCall`, so it shares the attempt budget and the pacing every other Linear call obeys.
 *
 * ## What is deliberately NOT copied from the Slack seam
 *
 * MEASURED against a real asset, reproduce with
 * `yarn tsx ~/.slopweaver/probes/linear-asset-<date>/probe-auth.mts <assetUrl>`:
 *
 * ```text
 * no header      -> HTTP 401, content-type application/json
 * Authorization  -> HTTP 200, content-type application/pdf, no redirect
 * ```
 *
 * Two of Slack's three written-down decisions do not transfer, and copying them would be cargo cult:
 *
 *  - **No HTML sign-in test.** That guards a Slack-specific failure where an unauthorised file URL serves
 *    HTTP 200 with a login form. Linear answers a JSON 401, which `response.ok` already catches.
 *  - **No redirect walk.** Slack follows one hop because a huddle transcript measured 302 and refusing meant
 *    "cannot read one at all". Linear answered 200 directly, so `redirect: "error"` is both correct and
 *    stricter — the same choice `../../atlas/vanta/documentDownload.ts` made for the same kind of URL. If
 *    Linear ever starts redirecting, this fails loudly instead of quietly replaying a credential.
 *
 * The one that DOES transfer is the host guard, because a credential replayed to another host is an
 * exfiltration primitive whatever the provider.
 *
 * ## Why this IS a `safeProviderCall` when `../../corpus/linear/writeAssets.ts`'s PUT is not
 *
 * That module deliberately keeps its upload outside the provider call, and states why: the presigned URL
 * "points at Linear's cloud-storage bucket, not at Linear's API — a different host, no API key". Neither
 * half of that holds here. This GET presents the same per-user credential every GraphQL read presents, to a
 * host that refuses it without one, so it plausibly spends the same per-user budget — and a 401 here IS a
 * Linear API fault rather than a storage one. The contrast is written down because the two calls look
 * alike from a distance and the reasoning inverts.
 *
 * ## The header has no `Bearer` prefix, and that is invisible until runtime
 *
 * A Linear personal API key is sent RAW. A line copied from the Slack seam sends `Bearer <key>` and earns a
 * 401 that reads exactly like a permissions problem. The probe above is what settles it.
 */
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { PDF_BYTES_MAX } from "../../pdf/limits.js";
import { LINEAR_ASSET_ORIGIN } from "./assetPlan.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";

/** The injected fetch seam, so the orchestration is provable with a plain fake and no network. */
export type FetchLinearAsset = (args: { url: string; token: string }) => Promise<Result<Uint8Array, LinearLiveError>>;

/**
 * Fetch one Linear-hosted asset's exact bytes.
 *
 * @param url the `uploads.linear.app` address found in a payload
 * @param token the Linear API key, sent raw
 * @returns the bytes, or a named reason they are not here
 */
export const fetchLinearAsset: FetchLinearAsset = async ({ url, token }) => {
  if (!url.startsWith(LINEAR_ASSET_ORIGIN)) {
    return err(LinearLiveErrors.assetUnreachable({ reason: "it is not hosted on Linear's asset storage", url }));
  }
  const fetched = await safeProviderCall({
    execute: async () => {
      const response = await fetch(url, { headers: { Authorization: token }, redirect: "error" });
      if (!response.ok) {
        throw new Error(`Linear's asset storage answered HTTP ${String(response.status)}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    operation: "linear.asset.download",
    provider: "linear",
    retryMode: "transient",
    scopeId: scopeIdForToken({ token }),
  });
  if (fetched.isErr()) {
    return err(LinearLiveErrors.assetUnreachable({ reason: fetched.error.message, url }));
  }
  if (fetched.value.byteLength > PDF_BYTES_MAX) {
    return err(
      LinearLiveErrors.assetUnreachable({
        reason: `it is ${String(fetched.value.byteLength)} bytes, past the ${String(PDF_BYTES_MAX)}-byte ceiling this reader holds in memory`,
        url,
      }),
    );
  }
  return ok(fetched.value);
};
