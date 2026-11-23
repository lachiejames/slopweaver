/**
 * PURE argument handling for `atlas google-admin connect`. The tail is parsed here and nowhere else, so a
 * malformed invocation is refused before a credential is read or a socket is opened.
 *
 * ## Why `all` is the default, when the Drive door's default is its NARROWEST grant
 *
 * The inversion is deliberate and it is the one thing in this file worth arguing about. `drive connect`
 * defaults to `metadata` because a Drive install has a genuinely useful narrow mode — answering "what is in
 * here and who owns it" without the ability to read a file. This door has no such mode. Its only consumer is
 * the `google-admin` ATLAS, whose whole subject is the shape of the console's surface, and a grant covering
 * five of the twenty-six areas produces an atlas that reports twenty-one of them not-configured — which is
 * an honest report of a half-useless run. The narrow choices below exist for someone who wants exactly one
 * area, and every one of them is still readonly, so the widest grant here still cannot change anything.
 *
 * ## Why `--without` exists, and the measurement that put it here
 *
 * MEASURED on this install's own Cloud project. Google's Data access page REFUSED
 * `cloud-identity.devices.readonly` when the owner pasted it — the picker would not add it — while
 * accepting the other 25. The consent endpoint then refused the WHOLE request rather than that one scope:
 * `Error 400: invalid_scope — Some requested scopes cannot be shown:
 * [https://www.googleapis.com/auth/cloud-identity.devices.readonly]`. So one scope a project cannot list
 * costs every other scope in the same consent, and nothing about the failure names a remedy.
 *
 * Which scopes a project lists is a property of THAT PROJECT, not of this repository, so the fix cannot be
 * to quietly shrink `all` — that would bake one install's console into a table describing Google's API, and
 * the next install would inherit a narrower grant with no reason recorded. `--without` puts the exclusion
 * at the call site where the fact lives, names it in the report, and leaves the capability true: the scope
 * IS published by `cloudidentity.v1` on six methods, and the atlas goes on saying so. An install that
 * excludes it gets an atlas reporting those three device kinds not-configured with the reason, which is
 * exactly what an unfilled surface is supposed to look like.
 */
import { err, ok, type Result } from "../../../../lib/result.js";
import { type GoogleAdminDoorError, GoogleAdminDoorErrors } from "../../../../live/googleAdmin/errors.js";
import { GOOGLE_ADMIN_CAPABILITIES, type GoogleAdminCapability } from "../../../../live/googleAdmin/scopes.js";
import { flagValueOr, parseFlagTail } from "../../../optionParsers.js";
import type { GoogleConnectArgs } from "../../google/connectShell.js";
import { type GoogleAdminConnectArgsError, GoogleAdminErrors } from "./errors.js";

/**
 * The capabilities `atlas google-admin connect` may be asked to request, by their flag-facing names.
 *
 * The groups are the Cloud APIs a person enables, not the atlas's own kinds, because enabling the API and
 * approving the scope are the two acts that must line up — a chosen group whose API is off answers 403 on
 * every call, and naming the group after the API is what makes that diagnosable.
 */
const GRANT_CHOICES: Readonly<Record<string, readonly GoogleAdminCapability[]>> = {
  all: GOOGLE_ADMIN_CAPABILITIES,
  chrome: [
    "chrome-app-details",
    "chrome-policy",
    "chrome-profiles",
    "chrome-reports",
    "chrome-security-insights",
    "chrome-telemetry",
  ],
  "cloud-identity": [
    "identity-allowlisted-domains",
    "identity-devices",
    "identity-groups",
    "identity-inbound-sso",
    "identity-policies",
  ],
  directory: [
    "datatransfer",
    "directory-calendar-resources",
    "directory-chromeos-devices",
    "directory-customer",
    "directory-domains",
    "directory-groups",
    "directory-mobile-devices",
    "directory-orgunits",
    "directory-printers",
    "directory-roles",
    "directory-schemas",
    "directory-users",
  ],
  reports: ["reports-audit", "reports-usage"],
  vault: ["vault-ediscovery"],
};

/**
 * Every capability name, as a set, so an unknown `--without` value is rejected without asserting a string
 * into the union — the check is what proves the name, and an assertion would only be asserting the check.
 */
const CAPABILITY_NAMES: ReadonlySet<string> = new Set(GOOGLE_ADMIN_CAPABILITIES);

/** The `--grant` names, in the order `--help` lists them. */
const GRANT_NAMES: readonly string[] = ["all", "directory", "reports", "chrome", "cloud-identity", "vault"];

/**
 * Split a `--without` value into capability names.
 *
 * @param value the raw comma-separated flag value
 * @returns each non-empty name, trimmed, in the order given
 */
function withoutNames({ value }: { value: string }): readonly string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * `atlas google-admin connect` usage.
 *
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const GOOGLE_ADMIN_CONNECT_USAGE =
  "usage: slopweaver atlas google-admin connect [--grant <all|directory|reports|chrome|cloud-identity|vault>]\n" +
  "       [--without <capability,...>] [--status] [--revoke] [--json] [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only\n" +
  "  Every scope requested is a `.readonly` one, and this door consents through its OWN OAuth client\n" +
  "  (`google-admin-client-id`) — so this consent screen cannot approve a write, and no other door's can\n" +
  "  put one on this credential either\n" +
  "  --grant    all (default) requests every readonly administrator scope the atlas maps; the others\n" +
  "             narrow it to one Cloud API's areas, which must be enabled on the project either way\n" +
  "  --without  drop named capabilities from the request. Google refuses a WHOLE consent when one scope\n" +
  "             is not listed on the project's Data access page, so this is how an install consents for\n" +
  "             the rest — the atlas then reports those areas not-configured with the reason\n" +
  "  --status   report the stored grant's account and scopes and stop — no browser, no socket\n" +
  "  --revoke   withdraw the stored grant at Google and delete it — no browser, no socket\n" +
  "  --json     emit the token-free grant status as one machine-readable document";

/** Every flag this verb's parser accepts, so the help-truth contract can check the usage against it. */
export const GOOGLE_ADMIN_CONNECT_FLAG_NAMES: readonly string[] = [
  "--grant",
  "--home",
  "--json",
  "--revoke",
  "--status",
  "--without",
];

/**
 * This door's refusal when no ADMIN OAuth client is configured — one text, read by the pair check and the
 * revocation seam alike, so the two can never tell an operator different things about the same missing secret.
 *
 * @returns the door's typed credential failure
 */
export function adminClientAbsent(): GoogleAdminDoorError {
  return GoogleAdminDoorErrors.credentialUnreadable({
    message:
      "no Google ADMIN OAuth client is configured. This door consents through its own Desktop-app " +
      "client, separate from the one the mail, Drive and calendar doors use, because Google merges " +
      "granted scopes over the (client, account) pair — a client that has been shown a write scope " +
      "can be issued a token carrying it. Create a SECOND Desktop-app OAuth client in the same Cloud " +
      "project, then run `slopweaver secrets set google-admin-client-id` and " +
      "`slopweaver secrets set google-admin-client-secret`. There is no fallback to " +
      "`google-client-id`: using it would put administrator scopes back on the client that can write",
  });
}

/**
 * Choose the OAuth client the admin door consents and revokes through, refusing the two configurations in
 * which it would not be a second client at all.
 *
 * The id comparison is the one this file exists for. A `google-admin-client-id` byte-identical to
 * `google-client-id` (a second SECRET on the same client) would route every admin consent and refresh
 * through the client that holds the Gmail writes, and a `--revoke` would withdraw the whole
 * (client, account) grant — the mail, Drive and calendar doors with it.
 *
 * @param adminClientId the configured admin client id, undefined when unset
 * @param adminClientSecret the configured admin client secret, undefined when unset
 * @param sharesUserDataClient whether that id equals the mail, Drive and calendar doors' client id
 * @returns the admin pair, or the door's credential failure saying which configuration was refused
 */
export function adminClientPair({
  adminClientId,
  adminClientSecret,
  sharesUserDataClient,
}: {
  adminClientId: string | undefined;
  adminClientSecret: string | undefined;
  sharesUserDataClient: boolean;
}): Result<{ clientId: string; clientSecret: string }, GoogleAdminDoorError> {
  if (adminClientId === undefined || adminClientSecret === undefined) {
    return err(adminClientAbsent());
  }
  if (sharesUserDataClient) {
    return err(
      GoogleAdminDoorErrors.credentialUnreadable({
        message:
          "`google-admin-client-id` names the SAME OAuth client as `google-client-id`, so this door has no " +
          "client of its own: a consent would be merged onto the client holding the Gmail writes, and a " +
          "revoke would withdraw the mail, Drive and calendar grants with it. A second secret on that client " +
          "is not a second client. Create a NEW Desktop-app OAuth client in the same Cloud project, then " +
          "`slopweaver secrets set google-admin-client-id` and `slopweaver secrets set google-admin-client-secret` " +
          "with its values",
      }),
    );
  }
  return ok({ clientId: adminClientId, clientSecret: adminClientSecret });
}

/**
 * Parse the `atlas google-admin connect` tail.
 *
 * @param rest the argv tail after `atlas google-admin connect`
 * @returns the validated request, or every reason it was refused
 */
export function parseGoogleAdminConnectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GoogleConnectArgs<GoogleAdminCapability>, GoogleAdminConnectArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "revoke", "status"], value: ["grant", "home", "without"] },
  });
  if (parsed.isErr()) {
    return err(GoogleAdminErrors.flagsInvalid({ reasons: parsed.error, usage: GOOGLE_ADMIN_CONNECT_USAGE }));
  }
  const grant = flagValueOr({ fallback: "all", name: "grant", parsed: parsed.value });
  const chosen = GRANT_CHOICES[grant];
  if (chosen === undefined) {
    return err(GoogleAdminErrors.grantUnknown({ grant, known: GRANT_NAMES, usage: GOOGLE_ADMIN_CONNECT_USAGE }));
  }
  const raw = parsed.value.values["without"];
  const excluded = raw === undefined ? [] : withoutNames({ value: raw });
  const unknown = excluded.filter((name) => !CAPABILITY_NAMES.has(name));
  if (unknown.length > 0) {
    return err(
      GoogleAdminErrors.capabilityUnknown({
        known: GOOGLE_ADMIN_CAPABILITIES,
        unknown,
        usage: GOOGLE_ADMIN_CONNECT_USAGE,
      }),
    );
  }
  if (excluded.includes("identity")) {
    return err(GoogleAdminErrors.identityExcluded({ usage: GOOGLE_ADMIN_CONNECT_USAGE }));
  }
  const capabilities = chosen.filter((capability) => !excluded.includes(capability));
  if (capabilities.length === 0) {
    return err(GoogleAdminErrors.nothingToConsent({ grant, usage: GOOGLE_ADMIN_CONNECT_USAGE }));
  }
  return ok({
    capabilities,
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    revoke: parsed.value.flags.has("revoke"),
    statusOnly: parsed.value.flags.has("status"),
  });
}
