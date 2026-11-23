/**
 * What an UNAUTHENTICATED probe of Knock's two APIs established, and why it is worth more here than the
 * equivalent probe is worth on most platforms.
 *
 * ## Both APIs discriminate, so both documents can be corroborated with no credential at all
 *
 * `api.knock.app` answers an unknown path `404 {"errors":{"detail":"404 Not Found"}}` and a known one
 * `401 {"code":"api_key_missing",…}`. `control.knock.app` answers `404 {"errors":{"detail":"Not Found"}}`
 * and `401 {"code":"bearer_token_missing",…}`. So an unauthenticated request separates "this route exists"
 * from "this route does not", which means both declared read surfaces can be checked against the running
 * service by an installation holding no Knock credential whatsoever.
 *
 * The two 404 bodies differ by the literal `404 ` prefix, and that difference is load-bearing rather than
 * cosmetic: it is how a response proves which SERVICE answered it, on two hosts whose 401 shapes are
 * otherwise identical in structure. A probe that matched on status alone could not tell a misrouted request
 * from a real negative.
 *
 * MEASURED against six controls, three per origin. Reproduce with:
 *
 * ```bash
 * yarn tsx tools/probeKnockSurface.ts            # print each declared GET's evidence class
 * yarn tsx tools/probeKnockSurface.ts --verify   # exit non-zero if this file disagrees
 * ```
 *
 * **All 86 declared GET operations were confirmed to exist — 39 on the data API and 47 on the Management
 * API. None answered 404, and every one of the six controls did.** That is a complete corroboration of both
 * documents' read surfaces against the live services, and it is the strongest claim this atlas makes.
 *
 * ## Only GETs are probed, and that is a rule rather than a shortcut
 *
 * The other 130 operations trigger a workflow, send a broadcast, promote a commit, delete a branch or
 * upsert a resource. An unauthenticated `PUT /v1/broadcasts/zzzsynthetic/send` would very probably answer
 * 401 and prove the route exists — and this atlas only ever reads, so it does not find out. The 130 are
 * inventoried from the documents with no probe evidence at all, and {@link KNOCK_PROBE_CENSUS} says so
 * rather than letting a reader mistake their absence for a negative result.
 *
 * ## Every parameter is obviously synthetic
 *
 * `zzzsynthetic` is substituted for every `{brace}` segment. This organisation's Knock workflow keys,
 * environment slugs and recipient identifiers are provider identifiers this repository may not carry, and a
 * probe that used a real one would be reaching for the ACCOUNT rather than for the route.
 */

/**
 * What an unauthenticated request established about one declared operation.
 *
 * - `exists-auth-required` — `401`, naming the credential the service wanted. The router resolved the path
 *   and the authenticator refused. The route EXISTS.
 * - `absent-404` — the same answer the controls get. Probed, and NOT there.
 * - `unprobed-mutating` — never requested, because it is not a GET. See this file's header.
 *
 * There is deliberately no `exists-validation-first` member, which the Prisma atlas has: Knock authenticates
 * before it validates on both APIs, uniformly, so no declared operation ever tells an anonymous caller
 * which parameters it wants. A member no row could take would be a contract claiming a distinction the
 * platform does not make.
 * @internal
 */
export const KNOCK_PROBE_EVIDENCE = ["exists-auth-required", "absent-404", "unprobed-mutating"] as const;

/** What an unauthenticated request established about one declared operation. */
export type KnockProbeEvidence = (typeof KNOCK_PROBE_EVIDENCE)[number];

/**
 * The refusal code each origin names when a route exists and no credential was presented.
 *
 * Two different words for one condition, which is why they are recorded per origin rather than matched
 * loosely: `api_key_missing` on the data API and `bearer_token_missing` on the Management API. The probe
 * asserts the exact code, so a service that started answering the other one — the shape a shared gateway
 * in front of both would produce — fails the run rather than passing quietly.
 * @internal
 */
export const KNOCK_AUTH_REFUSAL_CODES = {
  data: "api_key_missing",
  management: "bearer_token_missing",
} as const;

/**
 * The `errors.detail` each origin answers for a path it does not route.
 *
 * The data API's carries a literal `404 ` prefix and the Management API's does not. See this file's header
 * on why that difference is the control rather than a curiosity.
 * @internal
 */
export const KNOCK_NOT_FOUND_DETAILS = {
  data: "404 Not Found",
  management: "Not Found",
} as const;

/**
 * What the probe found, as the numbers a `--verify` run reproduces.
 *
 * Every field is asserted rather than described. A Knock release that retires a route, or that starts
 * validating before it authenticates, moves one of these and fails the generator.
 * @internal
 */
export const KNOCK_PROBE_CENSUS = {
  /** Declared GETs that answered 404 — the same answer the controls got. */
  absent: 0,
  /** Control paths requested per origin, all of which must answer that origin's own 404 body. */
  controlsPerOrigin: 3,
  /** Declared GETs on the data API that answered `401 api_key_missing`. */
  dataExists: 39,
  /** Declared GETs on the Management API that answered `401 bearer_token_missing`. */
  managementExists: 47,
  /** Operations never requested at all, because this atlas only ever reads. */
  unprobedMutating: 130,
} as const;
