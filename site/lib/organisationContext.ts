/**
 * Whether `slopweaver org show --json` (the `organisation` allowlist row) answered the store's typed "none written
 * yet" rather than a document.
 *
 * Anyone at any other company can set this up. The team workspace is a ROLE
 * (`./workspacePlacement.ts`), and which organisation fills it is the install's, written once by `org set`. An
 * unwritten store is told apart from a changed shape here so the console's refusal can carry the verb's own sentence,
 * which names `org set` as the repair. Pure: the read is `./placementOrganisationLive.ts`'s, once per document, and a
 * document is `./placementOrganisation.ts`'s to validate.
 */

/** The refusal code `org show` exits 3 with, which the allowlist row declares as its expected-empty answer. */
const NOT_CONFIGURED = "ORG_NOT_CONFIGURED";

/**
 * The verb's sentence when the payload is the runner's expected-empty answer for `ORG_NOT_CONFIGURED`.
 *
 * @param payload the live reading's payload, untrusted
 * @returns the sentence naming `org set`, or `undefined` for anything else, which the placement schema then reads
 */
export function organisationNotConfiguredWhy({ payload }: { payload: unknown }): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  if (!("kind" in payload) || payload.kind !== "expected-empty" || !("code" in payload)) {
    return undefined;
  }
  if (payload.code !== NOT_CONFIGURED || !("why" in payload) || typeof payload.why !== "string") {
    return undefined;
  }
  return payload.why;
}
