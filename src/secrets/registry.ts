/**
 * The credential REGISTER — one declaration per file that may stand in `$SLOPWEAVER_HOME/secrets`, and the
 * single source of truth three separate things now read.
 *
 * ## Why a register rather than a name list
 *
 * `secrets/names.ts` used to be the whole of what this install knew about its own credentials: a list of
 * strings a write was validated against. That made the store WRITE-ONLY. `src/cli/manifests/secrets.ts`
 * registered exactly one verb, `set`, so the owner's only view of their own credential store was `ls` — and
 * `ls` cannot say which platform a file belongs to, what it can reach, whether it was minted read-only,
 * when it stops working, or which verb reads it. Every one of those questions was answered by hand, once,
 * in an audit; an answer produced by hand goes stale the day after it is written.
 *
 * MEASURED by hand over 22 files — four states were standing and nothing in the install said
 * so: a Gmail grant whose cached access token had expired; a Drive grant carrying no `expiryMs`
 * key at all; `gmail-client-id`/`gmail-client-secret` with no reader anywhere in `src/`, while
 * `skills/calendar/reference/connecting.md` claimed they were read as a fallback; and five files that were
 * absent from the allowlist, so `secrets set` would have REFUSED to write the ones already on disk.
 * `slopweaver secrets status` surfaces all four unasked, computed rather than remembered.
 *
 * ## Where the rows live
 *
 * This file composes the register; the rows live in one category file each under `src/secrets/credentials/`,
 * spread into {@link CREDENTIALS} in the order below, and the row shape with what each field is for is
 * {@link CredentialSpec} in `credentials/spec.ts`:
 *
 * - `connectors.ts` — GitHub, Slack, Linear, Fathom and Notion;
 * - `serviceAccess.ts` — the live services a verb reads on demand: Datadog, Cloudflare, 1Password, Hex,
 *   KnowBe4, Twilio and Knock;
 * - `oauthClients.ts` — the Google and Outlook OAuth clients the consent doors stand on, and the SecOps
 *   instance;
 * - `atlas.ts` — the atlas platforms and the Playwright Extension token;
 * - `storeAndBackup.ts` — the local store's connection string, the backup's passphrase and its list of local destination directories;
 * - `grants.ts` — the user-consent grants and the ChatGPT web session;
 * - `retired.ts` — the names nothing reads any more.
 *
 * A new row goes in its category file; a category file nearing 300 code lines splits again into two
 * category files, each spread here in its place. `secretsRegistry` in `yarn lint` reads every row through
 * {@link CREDENTIALS}, and finds a peer branch's row in any file under `src/secrets/credentials/`.
 *
 * ## The allowlist is DERIVED from here
 *
 * {@link SecretName} and {@link SECRET_NAMES} are computed from the entries below rather than restated, so
 * `secrets set` and this register cannot drift. Two hand-kept lists agreeing with each other is not the same
 * as either agreeing with the store — `src/devLint/gateRegistration.ts` records what that cost the last time.
 * Every category array is `as const`, so the spread keeps each row's literal `name` and `settable` and
 * {@link SecretName} stays the exact union of settable names.
 */
import { ATLAS_CREDENTIALS } from "./credentials/atlas.js";
import { CONNECTOR_CREDENTIALS } from "./credentials/connectors.js";
import { GRANT_CREDENTIALS } from "./credentials/grants.js";
import { OAUTH_CLIENT_CREDENTIALS } from "./credentials/oauthClients.js";
import { RETIRED_CREDENTIALS } from "./credentials/retired.js";
import { SERVICE_ACCESS_CREDENTIALS } from "./credentials/serviceAccess.js";
import type { CredentialSpec } from "./credentials/spec.js";
import { STORE_AND_BACKUP_CREDENTIALS } from "./credentials/storeAndBackup.js";

export type { CredentialSpec } from "./credentials/spec.js";

/**
 * Every credential this install knows how to hold, in the order the owner reads them: the connectors first,
 * then the services a verb reads on demand, then the OAuth clients every consent door goes through, then the
 * atlas credentials, then the store and its backup, then the user-consent grants, then the retired names
 * still sitting on disk.
 *
 * A file in the store that is absent from here is an OFF-ALLOWLIST finding rather than an omission to
 * tolerate: it was placed by hand, or written from another checkout whose register carries a row this one
 * does not, so `secrets set` here would refuse to rewrite it and nothing here can say what it reaches. Add
 * the row — unless the gate names another branch as declaring it, in which case that branch lands it.
 */
export const CREDENTIALS = [
  ...CONNECTOR_CREDENTIALS,
  ...SERVICE_ACCESS_CREDENTIALS,
  ...OAUTH_CLIENT_CREDENTIALS,
  ...ATLAS_CREDENTIALS,
  ...STORE_AND_BACKUP_CREDENTIALS,
  ...GRANT_CREDENTIALS,
  ...RETIRED_CREDENTIALS,
] as const satisfies readonly CredentialSpec[];

/**
 * The connector secrets a user can persist, DERIVED from {@link CREDENTIALS} rather than restated. A grant
 * file is excluded because `normaliseSecretInput` rejects a multi-line value on purpose, and a retired name
 * is excluded so `secrets set` cannot mint fresh dead weight.
 */
export type SecretName = Extract<(typeof CREDENTIALS)[number], { settable: true }>["name"];

/** The accepted secret names, in the register's own display order. */
export const SECRET_NAMES: readonly SecretName[] = CREDENTIALS.flatMap((entry) => (entry.settable ? [entry.name] : []));

/**
 * The register keyed by file name, for the O(1) lookup both the status verb and the gate want.
 *
 * @returns a map from a store file name to its declaration
 */
export function credentialsByName(): ReadonlyMap<string, CredentialSpec> {
  return new Map(CREDENTIALS.map((entry) => [entry.name, entry]));
}
