import { err, ok, type Result } from "../../lib/result.js";

/**
 * Every method the probe may call. Each is a pure read: it returns state and changes none.
 *
 * Kept small on purpose. A method belongs here when a live measurement needs it, not when it happens to be
 * a read — the list is a permission surface, and an unused entry is surface for nothing.
 */
export const PROBE_READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  // Who the token is, and what it may do. The first call of any session.
  "auth.test",
  // The thread-refetch candidates. `history` and `replies` are the only two methods in the whole public
  // surface that return `reply_count`/`latest_reply`, which is what makes them the subject here.
  "conversations.history",
  "conversations.replies",
  "conversations.info",
  "conversations.list",
  "users.conversations",
  // The Tier-2 candidates: a different rate-limit bucket from `conversations.*`, so they can run alongside
  // a replies crawl at no cost to it.
  "search.messages",
  "search.all",
  // Real-time Search. A separate index and a separate, much tighter budget (10+/min per USER, pages
  // included) from the legacy `search.*` pair, so it is a distinct candidate rather than a spelling of one.
  "assistant.search.context",
  // The upload-readiness poll's own method — the only way to measure what a file's processing state looks
  // like from outside the send path, which is what an "it never finished processing" failure needs.
  "files.info",
  // The curated lane's own discovery walk. On the allowlist because what that walk RETURNS is a policy
  // question with a measurable answer — Slack's default `types` filter decides whether a huddle's notes
  // canvas is discoverable at all, and reading the code cannot tell you which way it went.
  "files.list",
  // Identity, for turning an id in a result into something a human can read.
  "users.info",
  "team.info",
  // The permalink for a message this session already knows the id of. On the list because the as-me lane
  // needed a way to MEASURE what a permalink for its own post looks like against a real thread, and could
  // not: the send path builds permalinks from the workspace url instead of asking (see
  // `../../outbound/slack/renderCheck.ts`, which explains why), so without this nothing could check that
  // the built string matches the one Slack itself hands out. Being on this list was NECESSARY and was not
  // sufficient — the probe reported field names and no values, so the comparison stayed impossible until
  // `--expect <path>=<value>` landed. Run it as
  // `slack probe --method chat.getPermalink channel=<c> ts=<ts> --expect permalink=<the built link>`.
  "chat.getPermalink",
  // The published read nearest a member's own Later list. MEASURED: a user token reaches it and it
  // returns starred CHANNELS only (every row it answered was `type: channel`), never Later — `slack saved` reads that.
  "stars.list",
]);

/** Why a probe request was refused. */
export type ProbeRefusal =
  | { readonly code: "METHOD_NOT_ALLOWED"; readonly message: string; readonly method: string }
  | { readonly code: "BAD_PARAM"; readonly message: string; readonly raw: string };

/** The refusal factories, so a test builds a refusal the same way the code does. */
const ProbeRefusals = {
  badParam: ({ raw }: { raw: string }): ProbeRefusal => ({
    code: "BAD_PARAM",
    message: `cannot read "${raw}" as a parameter — write each one as key=value`,
    raw,
  }),
  methodNotAllowed: ({ method }: { method: string }): ProbeRefusal => ({
    code: "METHOD_NOT_ALLOWED",
    message:
      `${method} is not on the probe's read-only allowlist. This verb can only ever READ. If the method ` +
      `genuinely reads, add it to PROBE_READ_ONLY_METHODS with a one-line reason — never widen a pattern.`,
    method,
  }),
} as const;

/** A resolved probe request: a method the allowlist admits, and the arguments to send with it. */
export interface ProbeRequest {
  readonly method: string;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Resolve a probe invocation, refusing anything that is not a known read.
 *
 * @param method the dotted Web API method name
 * @param params raw `key=value` strings, as typed on the command line
 * @returns the resolved request, or every reason it was refused
 */
export function resolveProbe({
  method,
  params,
}: {
  method: string;
  params: readonly string[];
}): Result<ProbeRequest, readonly ProbeRefusal[]> {
  const refusals: ProbeRefusal[] = [];
  if (!PROBE_READ_ONLY_METHODS.has(method)) {
    refusals.push(ProbeRefusals.methodNotAllowed({ method }));
  }
  const resolved: Record<string, string> = {};
  for (const raw of params) {
    const split = raw.indexOf("=");
    if (split <= 0) {
      refusals.push(ProbeRefusals.badParam({ raw }));
      continue;
    }
    resolved[raw.slice(0, split)] = raw.slice(split + 1);
  }
  return refusals.length > 0 ? err(refusals) : ok({ method, params: resolved });
}
