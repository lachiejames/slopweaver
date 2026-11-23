/**
 * What an UNAUTHENTICATED probe of the management API established, and why it is worth more here than the
 * equivalent probe is worth on most platforms.
 *
 * ## The API discriminates, so the document can be corroborated with no credential at all
 *
 * `api.prisma.io` answers an unknown path `404 {"error":{"code":"resource-not-found"}}` and a known one
 * either `401 authentication-failed` or `422 validation-error`. So an unauthenticated request separates
 * "this route exists" from "this route does not", which means the declared surface can be checked against
 * the running service by an installation holding no Prisma credential whatsoever.
 *
 * MEASURED against three controls, reproduce with:
 *
 * ```bash
 * yarn tsx tools/probePrismaDataPlatformSurface.ts            # print each declared GET's evidence class
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --verify   # exit non-zero if this file disagrees
 * ```
 *
 * **All 54 declared GET operations were confirmed to exist. None answered 404.** That is a complete
 * corroboration of the document's read surface against the live service, and it is the strongest claim any
 * of this atlas's surfaces currently makes.
 *
 * ## Only GETs are probed, and that is a rule rather than a shortcut
 *
 * The other 61 operations create, delete, promote, rotate, restore, lease or start something. An
 * unauthenticated `DELETE /v1/databases/zzzsynthetic` would very probably answer 401 and prove the route
 * exists — and this atlas only ever reads, so it does not find out. The 61 are inventoried from the
 * document with no probe evidence at all, and `PRISMA_PROBE_CENSUS.unprobedMutating` says so rather than
 * letting a reader mistake their absence for a negative result.
 *
 * ## Every parameter is obviously synthetic
 *
 * `zzzsynthetic` is substituted for every `{brace}` segment. This organisation's Prisma workspace, project
 * and database ids are provider identifiers this repository may not carry, and a probe that used a real one
 * would be reaching for the account rather than for the route.
 */

/**
 * What an unauthenticated request established about one declared operation.
 *
 * - `exists-auth-required` — `401 authentication-failed`. The router resolved the path and the
 *   authenticator refused. The route EXISTS.
 * - `exists-validation-first` — `422 validation-error`, naming a required parameter. The route exists AND
 *   its validator ran before its authenticator, so an anonymous caller learns which parameters it wants.
 *   Recorded separately from `exists-auth-required` because it is a different fact about the service, not a
 *   different confidence in the same one.
 * - `exists-unauthenticated` — `200`. It served a response with no credential presented.
 * - `absent-404` — `resource-not-found`, the same answer the controls get. Probed, and NOT there.
 * - `unprobed-mutating` — never requested, because it is not a GET. See this file's header.
 * @internal
 */
export const PRISMA_PROBE_EVIDENCE = [
  "exists-auth-required",
  "exists-validation-first",
  "exists-unauthenticated",
  "absent-404",
  "unprobed-mutating",
] as const;

/** What an unauthenticated request established about one declared operation. */
export type PrismaProbeEvidence = (typeof PRISMA_PROBE_EVIDENCE)[number];

/**
 * The controls, whose whole job is to fail.
 *
 * Three rather than one, at three different depths, because a service can route a shallow unknown path
 * differently from a deep one — and if a control ever stops answering 404, every other answer below stops
 * proving anything at all.
 */
export const PRISMA_PROBE_CONTROLS: readonly string[] = [
  "/v1/zzzcontrol",
  "/v1/databases/zzzsynthetic/zzzcontrol",
  "/v1/projects/zzzsynthetic/branches/zzzsynthetic/zzzcontrol",
];

/**
 * The census the probe asserts, so a silently shrinking result set is a refusal rather than a smaller number.
 */
export const PRISMA_PROBE_CENSUS = {
  /** Declared GET operations, every one of which was requested. */
  probedGets: 54,
  /** Of those, how many answered 401. */
  existsAuthRequired: 45,
  /** How many answered 422 — see {@link PRISMA_VALIDATION_FIRST_OPERATIONS}. */
  existsValidationFirst: 8,
  /** How many answered 200 with no credential — see {@link PRISMA_UNAUTHENTICATED_OPERATIONS}. */
  existsUnauthenticated: 1,
  /** How many answered the controls' own 404. ZERO: the document declares no GET the service does not serve. */
  absent: 0,
  /** Non-GET operations, inventoried from the document and deliberately never requested. */
  unprobedMutating: 61,
} as const;

/**
 * The eight GETs whose validator answers before their authenticator.
 *
 * Each answers `422 {"error":{"code":"validation-error","message":"<param>: Required"}}` to an anonymous
 * request. It confirms the route exists just as firmly as a 401 does, and it additionally tells an
 * unauthenticated caller which parameter the operation requires — a posture fact rather than a defect, and
 * worth being able to state either way.
 *
 * **Every one of the eight names a parameter the document already declares `required: true`**, so this is
 * corroboration rather than discovery: the running service and the document agree about what each operation
 * wants. Five of the eight are the Alchemy state store asking for its `alchemy-state-lease-id` HEADER,
 * which is the only header parameter anywhere on this surface — all 11 declarations of it are these
 * operations — and it is why an IaC state read is gated by a lease rather than by an id in the path.
 * @internal
 */
export const PRISMA_VALIDATION_FIRST_OPERATIONS: readonly { readonly path: string; readonly wants: string }[] = [
  { path: "/v1/integrations", wants: "workspaceId" },
  {
    path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages",
    wants: "alchemy-state-lease-id",
  },
  {
    path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/output",
    wants: "alchemy-state-lease-id",
  },
  {
    path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/replaced-resources",
    wants: "alchemy-state-lease-id",
  },
  {
    path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/resources",
    wants: "alchemy-state-lease-id",
  },
  {
    path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/resources/{fqn}",
    wants: "alchemy-state-lease-id",
  },
  { path: "/v1/scm-installations", wants: "workspaceId" },
  { path: "/v1/source-repositories", wants: "projectId" },
];

/**
 * The one GET that serves a response to an anonymous caller.
 *
 * `GET /v1/projects/{projectId}/branches/{branchId}/alchemy-state/version` answered `200 {"version":5}` for
 * two different synthetic project and branch ids, which is the empirical half of the disagreement
 * `generated/specLock.ts`'s {@link PRISMA_SPEC_DISAGREEMENTS} records: the operation's own description says
 * it is an unauthenticated contract-version probe that never inspects what it was addressed with, and the
 * probe confirms both halves of that sentence. Only its inherited `security` block disagrees.
 *
 * It is not a leak. The constant it returns is a contract version, identical for every caller, and the
 * repeated-id test is what establishes that it reveals nothing about the account addressed.
 * @internal
 */
export const PRISMA_UNAUTHENTICATED_OPERATIONS: readonly { readonly path: string; readonly serves: string }[] = [
  {
    path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/version",
    serves: 'the constant {"version":5} — the Alchemy state-store contract version, and nothing about the account',
  },
];

/**
 * Which evidence class one declared operation carries.
 *
 * Pure, and the single place the tables above are consulted, so the generator, the probe tool and the tests
 * read the same decision rather than three copies of it.
 *
 * @param method the operation's HTTP method
 * @param path the document's own path template, `{brace}` parameters intact
 * @returns what an unauthenticated request established, or would deliberately never be asked to
 */
export function prismaProbeEvidenceFor({ method, path }: { method: string; path: string }): PrismaProbeEvidence {
  if (method !== "GET") {
    return "unprobed-mutating";
  }
  if (PRISMA_UNAUTHENTICATED_OPERATIONS.some((row) => row.path === path)) {
    return "exists-unauthenticated";
  }
  if (PRISMA_VALIDATION_FIRST_OPERATIONS.some((row) => row.path === path)) {
    return "exists-validation-first";
  }
  return "exists-auth-required";
}
