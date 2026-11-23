/**
 * Operations this atlas inventories and never calls, each with the reason it is refused.
 *
 * ## Two different reasons, kept apart on purpose
 *
 * An operation is excluded either because calling it CHANGES something — so it is not observational at all
 * — or because its ordinary success response hands back secret material. Collapsing the two would hide
 * which property each row actually protects, and they fail differently: a side-effecting call is a rule
 * violation, while a secret-bearing read is a disclosure.
 *
 * ## These rows still exist
 *
 * They are addressable by surface name for inventory and coverage, publishing `state: "excluded"` with the
 * reason below, because an atlas that silently omitted them would answer "JumpCloud has no recovery-key
 * endpoint", which is false. What they do not have is a callable request variant — unreachable rather than
 * merely unused, the shape `atlas/onepassword/inventory.ts` proves.
 *
 * ## Endpoint exclusion is only half the boundary
 *
 * Several endpoints NOT listed here return secret material in ordinary fields — `GET /api/applications`
 * carries `idpPrivateKey` — and they are legitimately admitted because the owner's "every family in full"
 * ruling requires them. That half is `sensitiveFields.ts`. Reading this file as the whole defence is the
 * mistake its own header exists to prevent.
 */

/**
 * Why one operation is unreachable.
 * @internal
 */
export type JumpcloudExclusionReason = "side-effecting" | "secret-bearing";

/**
 * One refused operation: the path the specification declares, and why it is refused.
 * @internal
 */
export interface JumpcloudExclusion {
  /** The specification's own path key, without the origin or version prefix. */
  readonly pathKey: string;
  readonly method: "GET" | "POST";
  readonly reason: JumpcloudExclusionReason;
  /** Stated in the atlas's coverage output, so a reader learns what exists without it being fetched. */
  readonly detail: string;
}

/**
 * The refused set.
 *
 * Sixteen rows. Twelve came from the adversarial planning pass; the two Google EMM enrolment-token reads
 * were found afterwards by scanning every success schema for secret-shaped fields, which is why the count
 * in an earlier plan says twelve — that number is the pass's output, not this table's. The fifteenth is the
 * Apple MDM service-discovery validation, and it is the one worth remembering: a GET that VALIDATES makes
 * JumpCloud reach out to the MDM server, so the method being GET is not what decides whether a call is an
 * observation. Read the operation's own description, not its verb.
 *
 * The sixteenth is the same lesson learned a second time, and it took a live sync to see it. `GET
 * /api/v2/applications/{application_id}/import/users` asks JumpCloud to call the application's own identity
 * provider, so a full walk of this tenancy was making an outbound request against a third party once per
 * application. Nothing in the path or the verb says so; only the operation's description does.
 */
export const JUMPCLOUD_EXCLUSIONS: readonly JumpcloudExclusion[] = [
  {
    detail:
      "validates the MDM server's service-discovery URL, which makes JumpCloud reach out to it — an action, not a reading of stored state, despite being a GET",
    method: "GET",
    pathKey: "/applemdms/{deviceManagerObjectId}/validate-service-discovery-url",
    reason: "side-effecting",
  },
  {
    detail:
      "asks JumpCloud to reach out to the application's own identity provider and list the users available for import, so it is an outbound call on a third party rather than a reading of stored state. MEASURED against the live tenancy: it answers HTTP 500 for an application whose import integration is not configured, and a full sync would make this call once per application",
    method: "GET",
    pathKey: "/applications/{application_id}/import/users",
    reason: "side-effecting",
  },
  {
    detail: "sends an administrator-reactivation email, so it is not an observation at all",
    method: "GET",
    pathKey: "/users/reactivate/{id}",
    reason: "side-effecting",
  },
  {
    detail: "creates a report rather than observing existing state",
    method: "POST",
    pathKey: "/reports/{report_type}",
    reason: "side-effecting",
  },
  {
    detail: "returns a full-disk-encryption recovery key",
    method: "GET",
    pathKey: "/systems/{system_id}/fdekey",
    reason: "secret-bearing",
  },
  {
    detail: "returns a device Recovery Lock password",
    method: "GET",
    pathKey: "/applemdms/{deviceManagerObjectId}/devices/{deviceObjectId}/getrecoverylockpassword",
    reason: "secret-bearing",
  },
  {
    detail: "returns a device lock PIN",
    method: "GET",
    pathKey: "/applemdms/{deviceManagerObjectId}/devices/{deviceObjectId}/lockpin",
    reason: "secret-bearing",
  },
  {
    detail: "returns an active Android enrolment token, its enrolment link and its QR image",
    method: "GET",
    pathKey: "/google-emm/enterprises/{enterpriseObjectId}/enrollment-tokens",
    reason: "secret-bearing",
  },
  {
    detail: "returns one active Android enrolment token, its enrolment link and its QR image",
    method: "GET",
    pathKey: "/google-emm/enterprises/{enterpriseId}/enrollment-tokens/{tokenId}",
    reason: "secret-bearing",
  },
  {
    detail: "returns a stored credential's MFA code",
    method: "GET",
    pathKey: "/password-vault/credentials/{id}/mfa-code",
    reason: "secret-bearing",
  },
  {
    detail: "returns stored credential secret material",
    method: "GET",
    pathKey: "/password-vault/credentials/{id}/secret",
    reason: "secret-bearing",
  },
  {
    detail: "returns stored credential secret material",
    method: "GET",
    pathKey: "/password-vault/credentials/{id}/secret/v2",
    reason: "secret-bearing",
  },
  {
    detail: "returns a stored credential together with its secret material",
    method: "GET",
    pathKey: "/password-vault/credentials/{id}/with-secret",
    reason: "secret-bearing",
  },
  {
    detail: "returns Password Manager backup keys",
    method: "GET",
    pathKey: "/passwordmanager/backup/keys",
    reason: "secret-bearing",
  },
  {
    detail: "returns one Password Manager backup key",
    method: "GET",
    pathKey: "/passwordmanager/backup/keys/{UUID}",
    reason: "secret-bearing",
  },
  {
    detail: "returns privileged-access backup-key state and material",
    method: "GET",
    pathKey: "/privileged-access/backup-key",
    reason: "secret-bearing",
  },
];

/**
 * Whether one operation is refused, and why.
 *
 * @param pathKey the specification's own path key
 * @param method the operation's HTTP method
 * @returns the exclusion row, or `undefined` when the operation is callable
 * @internal
 */
export function jumpcloudExclusionFor({
  pathKey,
  method,
}: {
  pathKey: string;
  method: "GET" | "POST";
}): JumpcloudExclusion | undefined {
  return JUMPCLOUD_EXCLUSIONS.find((row) => row.pathKey === pathKey && row.method === method);
}
