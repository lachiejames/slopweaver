/**
 * The two readers of a Slack response's `response_metadata` — the scopes a token holds and the next page's cursor.
 * Split out of `./fetch.ts` under the file-size cap. `slackScopesFromMetadata` and `slackNextCursor` are exported from
 * here only and every caller imports them from here; `fetch.ts` no longer exports them, and neither module imports
 * the other.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * The scopes Slack says a token holds, off `auth.test`'s `response_metadata.scopes` — which is where
 * `@slack/web-api` puts the `x-oauth-scopes` response header. Pure.
 *
 * ## Why the token is asked instead of the manifest
 *
 * A manifest is a REQUEST. What a token holds is whatever was granted at the last install, and the two drift:
 * a scope added to a manifest is not held until someone reinstalls, and a scope held today is revoked the
 * moment a manifest omitting it is applied — manifests apply WHOLE. So the only defensible source is the
 * token's own answer, and one cheap reachability call yields it: nothing has to be ATTEMPTED to discover it is
 * not permitted.
 *
 * ## Undefined means "not established", never "none"
 *
 * Defensive rather than trusting, and the third state is load-bearing. A response with no metadata, or whose
 * `scopes` is not a list of strings, has told us nothing — and coercing that to `[]` would say Slack reported
 * a token holding nothing, which would make a failed diagnostic indistinguishable from a genuinely powerless
 * token. `live/slack/filePlan.ts#scopePreflight` keeps them apart precisely because the actions differ.
 *
 * The header can also lag behind a reinstall, so even a successful read is evidence rather than proof — which
 * is why its consumer reports a gap rather than refusing a read.
 *
 * @param metadata the SDK's `response_metadata`, whatever shape it arrived in
 * @returns the scope strings, or undefined when the response carried no usable list
 */
export function slackScopesFromMetadata({ metadata }: { metadata: unknown }): readonly string[] | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const scopes = metadata["scopes"];
  if (!Array.isArray(scopes)) {
    return undefined;
  }
  const strings = scopes.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
  return strings.length === 0 ? undefined : strings;
}

/**
 * The `nextCursor` off a Slack `response_metadata` — absent/empty ⇒ stop paging. Pure.
 *
 * @param metadata the `response_metadata` block, absent on a final page
 * @returns `{ nextCursor }` when there is another page, else an empty object — the key is OMITTED rather
 *   than set to undefined, so spreading it cannot introduce a stray key
 */
export function slackNextCursor({ metadata }: { metadata: { next_cursor?: string } | undefined }): {
  nextCursor?: string;
} {
  return metadata?.next_cursor !== undefined && metadata.next_cursor.length > 0
    ? { nextCursor: metadata.next_cursor }
    : {};
}
