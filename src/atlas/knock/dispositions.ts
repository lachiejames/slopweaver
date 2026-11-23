/**
 * What this atlas DOES with each of Knock's 216 declared operations, decided by rule rather than by a list.
 *
 * `docs/atlas-intent/06-holdings.md` sets the criterion, and it is applied per OPERATION rather than per family,
 * because it cuts THROUGH a family rather than along one. Knock is a clean example: `GET /v1/messages`
 * returns notification deliveries — emitted by the platform, unbounded, growing with the clock, identified
 * by an instant — while `GET /v1/message_types` returns message types somebody authored in the dashboard.
 * Same product area, same noun stem, opposite dispositions.
 *
 * ## The three rules, in the order they are applied
 *
 * 1. **Not a GET → `excluded` / `mutating`.** This atlas only ever reads. Knock upserts by `PUT`, so this
 *    is 130 of the 216 operations, and each is still inventoried with its path, parameters and tag — an
 *    excluded operation is one this atlas will not CALL, never one it declines to know about.
 * 2. **A GET under a voluminous prefix → `shape-index`.** {@link KNOCK_VOLUMINOUS_PREFIXES} is the whole
 *    set and each entry is justified below. Its shape is recorded and never a row per record.
 * 3. **`GET /v1/whoami` → `probe-only`.** It reports which service token this installation holds and what
 *    it is scoped to. That is a fact about the INSTALLATION rather than about the organisation, and it is
 *    what a `not-configured` coverage cell is answering when it says no credential exists.
 *
 * Everything else is an `entity`, with one modifier: a templated read whose identifiers NEITHER document
 * can produce is `excluded` / `not-enumerable`, because there is nothing for a sync to walk. That judgement
 * is {@link knockIdentifierSource}, and it is computed from the two documents rather than declared here.
 *
 * ## Why `/v1/commits` is NOT voluminous, and why stating that matters
 *
 * A commit log looks like the archetype of an append-only stream, and on most platforms it would be. Here
 * it is not: a Knock commit is a deliberate act a person performs in the dashboard to promote a change
 * between environments, it carries an author and a message, and the account's whole history of them is
 * small enough to list. It is CONFIGURATION somebody created, which is the complement the criterion names.
 * The same reading makes `assets`, `variables` and `tags` entities. The test is never "does this look like
 * a log" — it is whether the records are observations the platform emitted or things a person made.
 */

/**
 * Every path prefix whose GETs return time-series OBSERVATIONS rather than configuration.
 *
 * Each is a family the platform EMITS: identified by an instant, growing with the clock, with no
 * exhaustible end. Recorded here rather than in the generator so a reader can check the judgement without
 * reading generated output, and asserted by the generator so a prefix that stops matching any operation
 * fails the run rather than rotting.
 *
 * - `/v1/messages` — every notification Knock has delivered, plus its per-message events, delivery logs
 *   and activities. The largest family on the platform by orders of magnitude.
 * - `/v1/workflow_recipient_runs` — one record per recipient per workflow execution.
 * - `/v1/bulk_operations` — the progress record of a batch job, minted by the platform when one is enqueued.
 * - `/v1/users/{user_id}/messages`, `/v1/objects/{collection}/{id}/messages` — the same delivery stream,
 *   filtered to one recipient. Filtering an unbounded family does not bound it.
 * - `/v1/users/{user_id}/feeds` — in-app feed items, which are messages under a different name.
 * - `/v1/sources/{key}/events`, `/v1/sources/{key}/logs` — what a source has received, on the Management
 *   API. Its `/status` sibling one segment away is configuration and is an entity, which is the criterion
 *   cutting through the family rather than along it.
 */
export const KNOCK_VOLUMINOUS_PREFIXES: readonly string[] = [
  "/v1/bulk_operations",
  "/v1/messages",
  "/v1/objects/{collection}/{id}/messages",
  "/v1/sources/{key}/events",
  "/v1/sources/{key}/logs",
  "/v1/users/{user_id}/feeds",
  "/v1/users/{user_id}/messages",
  "/v1/workflow_recipient_runs",
] as const;

/**
 * The one operation this atlas calls and never stores.
 *
 * @internal
 */
export const KNOCK_PROBE_ONLY_PATH = "/v1/whoami";

/**
 * Whether one path sits under a voluminous family.
 *
 * @param path the document's own path template
 * @returns true when only this operation's SHAPE may be stored
 */
export function isKnockVoluminousPath({ path }: { path: string }): boolean {
  return KNOCK_VOLUMINOUS_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The collection path that produces the identifier one `{brace}` segment stands for.
 *
 * A templated read is walkable when, for every parameter in its path, the prefix ENDING just before that
 * parameter is itself a declared collection read. `GET /v1/users/{user_id}/preferences/{id}` needs both
 * `GET /v1/users` and `GET /v1/users/{user_id}/preferences`, and both are declared.
 *
 * @param path the document's own path template
 * @returns one entry per `{brace}` segment, in path order, naming the parameter and the collection whose
 *   read would produce it; empty when the path takes no parameter
 */
export function knockIdentifierSources({ path }: { path: string }): readonly { parameter: string; prefix: string }[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const needed: { parameter: string; prefix: string }[] = [];
  segments.forEach((segment, at) => {
    if (segment.startsWith("{")) {
      needed.push({ parameter: segment.slice(1, -1), prefix: `/${segments.slice(0, at).join("/")}` });
    }
  });
  return needed;
}

/**
 * Where a `{brace}` parameter's value comes from when the path-parent rule cannot say.
 *
 * {@link knockIdentifierSources} answers the common case — a templated read hangs off the collection one
 * segment above it — and it is wrong for CROSS-RESOURCE identifiers, which are the ones this platform
 * makes most use of. `GET /v1/users/{user_id}/channel_data/{channel_id}` needs a channel key, and no
 * operation named `/v1/users/{user_id}/channel_data` exists on either API. The producer is the Management
 * API's `GET /v1/channels`, one product area away.
 *
 * Without this table the atlas reports eight GETs as reachable by nobody when they are reachable by a
 * caller holding both credentials — a false claim of exactly the kind two surfaces exist to catch. The
 * table is keyed by PATH and PARAMETER rather than by parameter name alone, because `{id}` means a
 * different thing in every one of the three paths that use it, and a name-keyed table would be a rule that
 * happens to be right today.
 *
 * Every entry names a channel, and that is not a coincidence: Knock's channels are configured through the
 * Management API and consumed through the data API, so every identifier that crosses the two is one. An
 * entry whose path stops existing fails the generator rather than rotting.
 * @internal
 */
export const KNOCK_CROSS_API_IDENTIFIERS = {
  "/v1/objects/{collection}/{object_id}/channel_data/{channel_id}#channel_id": "/v1/channels",
  "/v1/providers/ms-teams/{channel_id}/auth_check#channel_id": "/v1/channels",
  "/v1/providers/ms-teams/{channel_id}/channels#channel_id": "/v1/channels",
  "/v1/providers/ms-teams/{channel_id}/teams#channel_id": "/v1/channels",
  "/v1/providers/slack/{channel_id}/auth_check#channel_id": "/v1/channels",
  "/v1/providers/slack/{channel_id}/channels#channel_id": "/v1/channels",
  "/v1/users/{user_id}/channel_data/{channel_id}#channel_id": "/v1/channels",
  "/v1/users/{user_id}/feeds/{id}#id": "/v1/channels",
  "/v1/users/{user_id}/feeds/{id}/settings#id": "/v1/channels",
  "/v1/users/{user_id}/guides/{channel_id}#channel_id": "/v1/channels",
} as const satisfies Readonly<Record<string, string>>;

/** One `<path>#<parameter>` key the cross-API table declares. */
type KnockCrossApiKey = keyof typeof KNOCK_CROSS_API_IDENTIFIERS;

/**
 * Whether a composed `<path>#<parameter>` key is one the cross-API table declares as its OWN — never an
 * inherited `Object.prototype` member, which a bare index would have handed back as a producer.
 */
function isCrossApiKey(key: string): key is KnockCrossApiKey {
  return Object.hasOwn(KNOCK_CROSS_API_IDENTIFIERS, key);
}

/**
 * Which collection produces one parameter of one path, when the path-parent rule found nothing.
 *
 * @param path the document's own path template
 * @param parameter the `{brace}` parameter's own name, braces stripped
 * @returns the producing collection's path, or `null` when nothing declared produces it
 */
export function knockCrossApiProducer({ path, parameter }: { path: string; parameter: string }): string | null {
  const key = `${path}#${parameter}`;
  if (!isCrossApiKey(key)) {
    // Absent by design: no cross-API row names this pair, so nothing declared produces the parameter.
    return null;
  }
  return KNOCK_CROSS_API_IDENTIFIERS[key];
}
