/**
 * Which Google scope each Google Admin capability needs — this door's own vocabulary, read by the shared
 * helpers in `src/live/google/scopes.ts`.
 *
 * ## Every scope here is a `.readonly` one, and that is the door's whole shape
 *
 * The Admin APIs administer the organisation: they create users, delete groups, wipe devices and change
 * policy. This door exists to let the `google-admin` ATLAS read what is there, so it asks for the readonly
 * half of each pair and nothing else. The consent screen a person is sent to therefore cannot approve a
 * write, which is a property of what is requested rather than a promise about what the code does with it.
 * `src/atlas/googleAdmin/dispositions.ts` refuses to derive read-versus-write from a declared scope for a
 * separate and good reason — Google publishes 175 mutating methods here, two of them gated by a `.readonly`
 * scope alone — and that is why the disposition, not the scope, is what decides whether an operation may be
 * CALLED. This table decides only what may be ASKED FOR.
 *
 * ## One capability is one scope, and the names are console areas
 *
 * A capability is named for what a reader would say they want to see — `directory-users`,
 * `chrome-telemetry`, `vault-ediscovery` — because that is what appears on `atlas google-admin connect
 * --grant`. There are 26 of them beside `identity`, and they are hand-written rather than derived from
 * `generated/surfaces.ts`: a table that recomputed itself would silently change what a person is asked to
 * approve the day Google republishes a discovery document. What IS derived is the CHECK —
 * `src/__tests__/unit/live/googleAdmin/scopes.test.ts` asserts this table against the generated registry,
 * so a drift fails a test instead of changing a consent screen.
 *
 * `impliedBy` carries the WRITE parent of each readonly scope, and only where the registry declares that
 * parent — Google's scopes nest, so a person who already approved `admin.directory.user` elsewhere must not
 * be told to re-consent for `admin.directory.user.readonly`. Five of the 26 have no parent in the registry
 * at all (`admin.reports.*`, `chrome.management.appdetails`, `.reports`, `.telemetry`): Google publishes
 * those as readonly-only, so their implication list is empty rather than invented.
 *
 * Pure: no I/O, no clock.
 */
import type { GoogleScopeTable } from "../google/scopes.js";

/** Where every Google OAuth scope URI in this file lives, written once so 27 lines cannot disagree. */
const GOOGLE_AUTH_PREFIX = "https://www.googleapis.com/auth/";

/**
 * The Google Admin capability a caller needs. One capability maps to exactly one scope URI.
 *
 * Named for the Admin console area it opens rather than for the API that serves it, because two of these
 * (`directory-printers`, `chrome-policy`) are served by a document whose name does not match the area.
 */
export type GoogleAdminCapability =
  | "chrome-app-details"
  | "chrome-policy"
  | "chrome-profiles"
  | "chrome-reports"
  | "chrome-security-insights"
  | "chrome-telemetry"
  | "datatransfer"
  | "directory-calendar-resources"
  | "directory-chromeos-devices"
  | "directory-customer"
  | "directory-domains"
  | "directory-groups"
  | "directory-mobile-devices"
  | "directory-orgunits"
  | "directory-printers"
  | "directory-roles"
  | "directory-schemas"
  | "directory-users"
  | "identity"
  | "identity-allowlisted-domains"
  | "identity-devices"
  | "identity-groups"
  | "identity-inbound-sso"
  | "identity-policies"
  | "reports-audit"
  | "reports-usage"
  | "vault-ediscovery";

/** Every capability, in the order `connect --grant all` requests them. */
export const GOOGLE_ADMIN_CAPABILITIES: readonly GoogleAdminCapability[] = [
  "chrome-app-details",
  "chrome-policy",
  "chrome-profiles",
  "chrome-reports",
  "chrome-security-insights",
  "chrome-telemetry",
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
  "identity",
  "identity-allowlisted-domains",
  "identity-devices",
  "identity-groups",
  "identity-inbound-sso",
  "identity-policies",
  "reports-audit",
  "reports-usage",
  "vault-ediscovery",
] as const;

/** The scope URI granted for each capability. Every one of the 26 beyond `identity` is a readonly scope. */
export const GOOGLE_ADMIN_SCOPES: Readonly<Record<GoogleAdminCapability, string>> = {
  "chrome-app-details": `${GOOGLE_AUTH_PREFIX}chrome.management.appdetails.readonly`,
  "chrome-policy": `${GOOGLE_AUTH_PREFIX}chrome.management.policy.readonly`,
  "chrome-profiles": `${GOOGLE_AUTH_PREFIX}chrome.management.profiles.readonly`,
  "chrome-reports": `${GOOGLE_AUTH_PREFIX}chrome.management.reports.readonly`,
  "chrome-security-insights": `${GOOGLE_AUTH_PREFIX}chrome.management.securityinsights.readonly`,
  "chrome-telemetry": `${GOOGLE_AUTH_PREFIX}chrome.management.telemetry.readonly`,
  datatransfer: `${GOOGLE_AUTH_PREFIX}admin.datatransfer.readonly`,
  "directory-calendar-resources": `${GOOGLE_AUTH_PREFIX}admin.directory.resource.calendar.readonly`,
  "directory-chromeos-devices": `${GOOGLE_AUTH_PREFIX}admin.directory.device.chromeos.readonly`,
  "directory-customer": `${GOOGLE_AUTH_PREFIX}admin.directory.customer.readonly`,
  "directory-domains": `${GOOGLE_AUTH_PREFIX}admin.directory.domain.readonly`,
  "directory-groups": `${GOOGLE_AUTH_PREFIX}admin.directory.group.readonly`,
  "directory-mobile-devices": `${GOOGLE_AUTH_PREFIX}admin.directory.device.mobile.readonly`,
  "directory-orgunits": `${GOOGLE_AUTH_PREFIX}admin.directory.orgunit.readonly`,
  "directory-printers": `${GOOGLE_AUTH_PREFIX}admin.chrome.printers.readonly`,
  "directory-roles": `${GOOGLE_AUTH_PREFIX}admin.directory.rolemanagement.readonly`,
  "directory-schemas": `${GOOGLE_AUTH_PREFIX}admin.directory.userschema.readonly`,
  "directory-users": `${GOOGLE_AUTH_PREFIX}admin.directory.user.readonly`,
  identity: `${GOOGLE_AUTH_PREFIX}userinfo.email`,
  "identity-allowlisted-domains": `${GOOGLE_AUTH_PREFIX}cloud-identity.allowlisteddomains.readonly`,
  "identity-devices": `${GOOGLE_AUTH_PREFIX}cloud-identity.devices.readonly`,
  "identity-groups": `${GOOGLE_AUTH_PREFIX}cloud-identity.groups.readonly`,
  "identity-inbound-sso": `${GOOGLE_AUTH_PREFIX}cloud-identity.inboundsso.readonly`,
  "identity-policies": `${GOOGLE_AUTH_PREFIX}cloud-identity.policies.readonly`,
  "reports-audit": `${GOOGLE_AUTH_PREFIX}admin.reports.audit.readonly`,
  "reports-usage": `${GOOGLE_AUTH_PREFIX}admin.reports.usage.readonly`,
  "vault-ediscovery": `${GOOGLE_AUTH_PREFIX}ediscovery.readonly`,
} as const;

/**
 * The Google Admin door's scope vocabulary, in the shape every shared grant helper reads.
 *
 * Each `impliedBy` entry is the readonly scope with `.readonly` removed, kept only where the generated
 * registry declares that wider scope — see this file's header. Nothing implies `identity`.
 */
export const GOOGLE_ADMIN_SCOPE_TABLE: GoogleScopeTable<GoogleAdminCapability> = {
  identity: "identity",
  impliedBy: {
    "chrome-app-details": [],
    "chrome-policy": [`${GOOGLE_AUTH_PREFIX}chrome.management.policy`],
    "chrome-profiles": [`${GOOGLE_AUTH_PREFIX}chrome.management.profiles`],
    "chrome-reports": [],
    "chrome-security-insights": [`${GOOGLE_AUTH_PREFIX}chrome.management.securityinsights`],
    "chrome-telemetry": [],
    datatransfer: [`${GOOGLE_AUTH_PREFIX}admin.datatransfer`],
    "directory-calendar-resources": [`${GOOGLE_AUTH_PREFIX}admin.directory.resource.calendar`],
    "directory-chromeos-devices": [`${GOOGLE_AUTH_PREFIX}admin.directory.device.chromeos`],
    "directory-customer": [`${GOOGLE_AUTH_PREFIX}admin.directory.customer`],
    "directory-domains": [`${GOOGLE_AUTH_PREFIX}admin.directory.domain`],
    "directory-groups": [`${GOOGLE_AUTH_PREFIX}admin.directory.group`],
    "directory-mobile-devices": [`${GOOGLE_AUTH_PREFIX}admin.directory.device.mobile`],
    "directory-orgunits": [`${GOOGLE_AUTH_PREFIX}admin.directory.orgunit`],
    "directory-printers": [`${GOOGLE_AUTH_PREFIX}admin.chrome.printers`],
    "directory-roles": [`${GOOGLE_AUTH_PREFIX}admin.directory.rolemanagement`],
    "directory-schemas": [`${GOOGLE_AUTH_PREFIX}admin.directory.userschema`],
    "directory-users": [`${GOOGLE_AUTH_PREFIX}admin.directory.user`],
    identity: [],
    "identity-allowlisted-domains": [`${GOOGLE_AUTH_PREFIX}cloud-identity.allowlisteddomains`],
    "identity-devices": [`${GOOGLE_AUTH_PREFIX}cloud-identity.devices`],
    "identity-groups": [`${GOOGLE_AUTH_PREFIX}cloud-identity.groups`],
    "identity-inbound-sso": [`${GOOGLE_AUTH_PREFIX}cloud-identity.inboundsso`],
    "identity-policies": [`${GOOGLE_AUTH_PREFIX}cloud-identity.policies`],
    "reports-audit": [],
    "reports-usage": [],
    "vault-ediscovery": [`${GOOGLE_AUTH_PREFIX}ediscovery`],
  },
  scopes: GOOGLE_ADMIN_SCOPES,
};
