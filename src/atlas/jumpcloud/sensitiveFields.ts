/**
 * The response fields this atlas refuses to store, named one at a time.
 *
 * ## Why a named set rather than a pattern
 *
 * The obvious design is a regex over field names, and it is wrong in both directions. MEASURED
 * by scanning every 200-response schema in the three pinned JumpCloud specifications (resolving `$ref` and
 * `allOf`/`oneOf`/`anyOf` five levels deep): 111 distinct field names look secret-shaped, and the large
 * majority of them are POSTURE — `mfaEnrollment`, `passwordExpirationInDays`, `hasSecureToken`,
 * `passwordsScore` — which is precisely what an ISO 27001 endpoint question is asking for. A pattern that
 * denies them makes the atlas stop answering the question it exists to answer.
 *
 * The sibling Vanta atlas ran the same scan against its own published generation and its pattern bucketed
 * legitimate policy fields (`passwordMFA`, `passwordMinimumLength`, `passwordRequiresNumber`,
 * `passwordRequiresSymbol`) as secrets, because they match on "password" and match no posture keyword. That
 * is the failure in one direction; a future field called `apiSecret` sailing through a keyword list that
 * happens not to contain it is the failure in the other.
 *
 * So the rule is **secret MATERIAL out, POSTURE in**, and every denial below is an individual decision with
 * its reason attached. Reproduce the scan with:
 *
 * ```bash
 * slopweaver dev jumpcloud-secret-scan   # or the ad-hoc parse recorded in the handover doc
 * ```
 *
 * ## Why this exists at all, when there is already a closed endpoint registry
 *
 * Because an endpoint allowlist does not protect this atlas. Every field below is returned by an endpoint
 * that is legitimately ADMITTED and that the owner's "every family in full" ruling requires syncing —
 * `GET /api/applications` carries `idpPrivateKey` on its application records, and it sits in the
 * original ISO kind floor. Endpoint exclusion and field exclusion are different boundaries and this atlas
 * needs both.
 */

/**
 * Field names whose VALUE is secret material, or a fragment of it, and is never stored.
 *
 * A fragment counts: `apiKeyPrefix` is part of a credential, and this repository's own rule about private
 * identifiers already holds that a split or partial secret is still the secret. The `*Config` entries are
 * denied because they are container objects around the same material rather than because their own name is
 * alarming.
 */
export const JUMPCLOUD_SECRET_MATERIAL_FIELDS: readonly string[] = [
  "apiKey",
  "apiKeyConfig",
  "apiKeyHash",
  "apiKeyPrefix",
  "authPassword",
  "authToken",
  "clientSecret",
  "clientSecretConfig",
  "credential",
  "credentials",
  "enrollmentLink",
  "idpPrivateKey",
  "mfaKey",
  "passphrase",
  "password",
  "passwords",
  "privateKey",
  "qrCodeImage",
  "scimToken",
  "secret",
  "secrets",
  "sharedSecret",
  "twoFaSecret",
];

/**
 * Field names that are ephemeral request-scoped handles, dropped because storing them is meaningless.
 *
 * Separate from {@link JUMPCLOUD_SECRET_MATERIAL_FIELDS} on purpose: these are not a disclosure problem, so
 * conflating them would make the secret list look longer than it is and hide what it actually protects. A
 * pagination cursor in a stored generation is stale the moment it is written.
 */
export const JUMPCLOUD_EPHEMERAL_TOKEN_FIELDS: readonly string[] = [
  "cacheToken",
  "continuationToken",
  "fileToken",
  "nextPageToken",
  "skipToken",
];

/**
 * Why one field was refused, kept apart from the fact that it was.
 *
 * The two lists above are deliberately disjoint and mean different things to a reader of coverage —
 * withholding a SAML private key is a disclosure decision, dropping a pagination cursor is housekeeping —
 * so the boundary reports which of the two applied rather than a bare boolean that conflates them.
 * @internal
 */
export type JumpcloudDenialReason = "secret-material" | "ephemeral-token";

/**
 * Fields denied only under the ENDPOINT that returns them, because the same name is ordinary everywhere else.
 *
 * The header above says JumpCloud is consistent enough about its own names that no scoping is needed. One
 * endpoint breaks that, and pretending otherwise costs either the whole atlas or a live credential.
 *
 * `GET /api/v2/systeminsights/services` returns a Windows service's `path`, and on Windows a service's path
 * is its **ImagePath**, which is the full command line. A service wrapper launched with credentials passed
 * as `--env` arguments puts an AWS key pair in that column, and only the access-key-id half of a pair has a
 * shape any scanner can recognise, which is the whole argument for withholding the column rather than
 * trusting the gate to catch what is in it.
 *
 * **This is structural, not a per-service judgement.** Any service on any device can be configured with a
 * secret on its command line, and the atlas re-reads every device on every sync, so no one-off clean-up
 * could ever make the column safe.
 *
 * A GLOBAL `path` denial was rejected and is the obvious wrong move. `path` is core device-inventory data —
 * installed applications, launch daemons, startup items, mounts — and denying it everywhere would gut the
 * inventory to protect one column. Scoping to the KIND was rejected for the same reason at smaller scale,
 * since `services` shares kind `systeminsights` with fifty other tables.
 *
 * The reason recorded is `secret-material` rather than a new third kind. A third `AtlasDenialReason` is a
 * kit-wide change that every atlas's coverage sentence would have to learn, and this withholding IS a
 * disclosure decision a reader of coverage must be told about, which is exactly what that reason means.
 */
const JUMPCLOUD_ENDPOINT_SCOPED_DENIALS: readonly {
  readonly endpoint: string;
  readonly field: string;
  /** When present, the denial applies only where the record's own sibling field holds one of these values. */
  readonly sibling?: { readonly field: string; readonly oneOf: readonly string[] };
}[] = [
  { endpoint: "/systeminsights/services", field: "path" },
  {
    endpoint: "/systeminsights/managed_policies",
    field: "value",
    sibling: { field: "name", oneOf: ["ConnectKey"] },
  },
];

/**
 * Whether this endpoint is one an endpoint-scoped denial names.
 *
 * An endpoint the caller could not supply matches EVERY entry rather than none. A stored entity whose
 * channel lost its source is the case that produces one, and failing open there would carry a withheld
 * field forward forever behind a document nobody re-read — the exact defect `reprojectStoredEntities`
 * exists to close.
 *
 * @param endpoint the bound provider path this document came through, or `undefined` when it is unknown
 * @param suffix the path tail the denial is scoped to
 * @returns whether the denial applies here
 */
function endpointMatches({ endpoint, suffix }: { endpoint: string | undefined; suffix: string }): boolean {
  if (endpoint === undefined) {
    return true;
  }
  return endpoint.split("?")[0]?.endsWith(suffix) === true;
}

/**
 * Whether the sibling a scoped denial names holds one of the values it names.
 *
 * A denial with no sibling clause needs no confirmation and applies on the endpoint alone. One WITH a clause
 * is deliberately the strict direction: an absent or unexpected sibling does NOT deny, so a record shape
 * that changed under us keeps its value and the pre-publish gate refuses the generation instead. That is the
 * fail-safe worth stating, because it is the opposite of {@link endpointMatches}'s: a missing ENDPOINT means
 * nobody can say where this came from, while a missing SIBLING means this is not the row we classified, and
 * a refusal a human then reads is better than a silent withholding nobody asked for.
 *
 * @param entry the sibling clause, when the denial has one
 * @param record the object the denied field sits directly in
 * @returns whether the denial applies to this record
 */
function siblingMatches({
  entry,
  record,
}: {
  entry: { readonly field: string; readonly oneOf: readonly string[] } | undefined;
  record: Readonly<Record<string, unknown>>;
}): boolean {
  if (entry === undefined) {
    return true;
  }
  const value = record[entry.field];
  return typeof value === "string" && entry.oneOf.includes(value);
}

/**
 * Why one field name is refused at the projection boundary, or `null` if it is not.
 *
 * @param field the provider's own property name, compared exactly rather than case-folded — JumpCloud is
 * consistent about casing within a schema, and a case-insensitive test would start matching names nobody
 * reviewed
 * @param endpoint the bound path this document came through, which decides the endpoint-scoped denials
 * below. `undefined` means it could not be established, and every scoped denial then applies
 * @param record the object this field sits directly in, so a denial that needs a sibling can read one.
 * Defaults to empty, which denies nothing a sibling would have to confirm
 * @returns which list refused the field, or `null` when it may be stored
 */
export function jumpcloudFieldDenial({
  field,
  endpoint,
  record = {},
}: {
  field: string;
  endpoint: string | undefined;
  record?: Readonly<Record<string, unknown>>;
}): JumpcloudDenialReason | null {
  if (JUMPCLOUD_SECRET_MATERIAL_FIELDS.includes(field)) {
    return "secret-material";
  }
  if (JUMPCLOUD_EPHEMERAL_TOKEN_FIELDS.includes(field)) {
    return "ephemeral-token";
  }
  const scoped = JUMPCLOUD_ENDPOINT_SCOPED_DENIALS.some(
    (entry) =>
      entry.field === field &&
      endpointMatches({ endpoint, suffix: entry.endpoint }) &&
      siblingMatches({ entry: entry.sibling, record }),
  );
  return scoped ? "secret-material" : null;
}
