/**
 * What the JumpCloud atlas holds, and the permanent boundary of what it can ever claim.
 *
 * Kinds are the provider's own first path segment rather than an invented taxonomy, so a reader who knows
 * the console knows the kind. `systeminsights` is one kind carrying sixty tables rather than sixty kinds,
 * because the console presents it as one surface and splitting it would put the same platform data in the
 * catalogue sixty times.
 */
import { KIT_GAP_CONDITIONS } from "../kit/gaps.js";

/** The single platform this atlas maps. One PLATFORM, two SURFACES — see `kit/contract.ts`. */
export const JUMPCLOUD_ATLAS_PLATFORM = "jumpcloud";

/**
 * Every kind this atlas publishes a file for — one per reachable root in the generated registry.
 *
 * Written out rather than computed so the list stays a literal union a caller can be checked against, and
 * pinned to the registry by `model.test.ts`, which asserts EXACT equality with its reachable kinds. An
 * earlier revision declared twelve of these and parked the other sixty-two as a shortfall to close later:
 * that made an omission the type system could not see and a coverage cell could not report, because a kind
 * nothing declares is a kind no generation can publish a non-`synced` state for. It reads as a kind that
 * does not exist, which is exactly the silence the owner's every-family-in-full ruling refuses.
 *
 * A kind here is a DECLARATION, never a claim that anything has been read: both surfaces are
 * `declared-unfilled` and each kind's own coverage cell says what actually happened to it.
 * @internal
 */
export const JUMPCLOUD_KINDS = [
  "accessrequests",
  "activedirectories",
  "administrators",
  "alerts",
  "alerts-stats",
  "applemdms",
  "application-templates",
  "applications",
  "approvalflowrequest",
  "approvalflows",
  "approvalflowsettings",
  "approversprogress",
  "assets",
  "authn",
  "bulk",
  "cases",
  "commandresults",
  "commands",
  "customemail",
  "customemails",
  "devices",
  "directories",
  "duo",
  "events",
  "feature-settings",
  "featureTrials",
  "files",
  "gcep",
  "google-emm",
  "groups",
  "gsuites",
  "healthmonitoring",
  "identity-provider",
  "identityrisk",
  "integrations",
  "iplists",
  "ldapservers",
  "logos",
  "notifications",
  "object-storage",
  "office365s",
  "organizations",
  "password-manager",
  "password-vault",
  "passwordmanager",
  "passwordmanageritems",
  "passwordpolicies",
  "policies",
  "policygroups",
  "policyresults",
  "policytemplates",
  "privileged-access",
  "providers",
  "pushendpoints",
  "queuedcommand",
  "radiusservers",
  "reports",
  "roles",
  "saas-management",
  "saved-views",
  "scope-groups",
  "search",
  "service-accounts",
  "software",
  "softwareapps",
  "subscriptions",
  "systemgroups",
  "systeminsights",
  "systems",
  "systemusers",
  "usergroups",
  "users",
  "workdays",
  "workflows",
] as const;

/**
 * One kind this atlas publishes.
 * @internal
 */
export type JumpcloudKind = (typeof JUMPCLOUD_KINDS)[number];

/**
 * The permanent claim boundary — what "complete" can ever mean for this credential.
 *
 * Stated in the credential's own terms rather than as a reassurance: the key belongs to an administrator,
 * so the API half is bounded by what that administrator's role can see, and the read-only property is
 * carried by this repository's code rather than by the identity. The owner accepted that explicitly.
 */
export const JUMPCLOUD_VISIBILITY_SCOPE =
  "a single JumpCloud organisation, read with an administrator's API key and bounded by what that administrator's role can see; read-only is enforced by a closed surface registry, an allowlist projection and a pre-publish refusal, never by the credential's own scope";

/**
 * Schema version of every JumpCloud kind file and manifest.
 *
 * Bumping it forces an archive-and-resync on every install holding data, so it moves only for a real
 * layout change — `store.ts` refuses to read a generation declaring a different one and names the remedy.
 */
export const JUMPCLOUD_SCHEMA_VERSION = 1;

/**
 * The two surfaces, named exactly as `descriptor.ts` names them.
 *
 * A stored record may only claim one of these, which is what stops a channel appearing on disk that the
 * descriptor never declared — the state a reader of coverage could not interpret at all.
 */
export const JUMPCLOUD_SURFACE_NAMES = ["directory-api", "admin-console"] as const;

/** One declared surface of this atlas. @internal */
export type JumpcloudSurfaceName = (typeof JUMPCLOUD_SURFACE_NAMES)[number];

/**
 * Every condition a JumpCloud gap can carry. Closed, so a recheck can match a stored gap exactly.
 *
 * Four are this platform's own and each records something a coverage state alone cannot say. `path-unbound`
 * is an admitted operation whose parent collection supplied no id this run — the operation exists and is
 * callable, so recording it as unreadable would be a lie about the credential. `reachable-but-empty` is the
 * trap the pre-mortem measured: an endpoint for a product the tenancy has not provisioned
 * (`/api/radiusservers`, `/api/v2/duo/accounts`, `/api/v2/activedirectories`, `/api/v2/workdays`) returns
 * zero records, so an attribute census over it has zero observations and claims a complete vocabulary derived from nothing. `unstable-page-order`
 * is an offset walk that ended short of the provider's own declared total. `temporally-incomparable` is two
 * observations whose read epochs do not overlap, which is a fact about the comparison rather than about
 * either surface.
 */
export const JUMPCLOUD_GAP_CONDITIONS = [
  "path-unbound",
  "request-contract-unknown",
  "reachable-but-empty",
  "unstable-page-order",
  "temporally-incomparable",
  "incomplete-read",
  "auth-refused",
  "redirect-refused",
  "schema-drift",
  // Kit-owned: corroboration between surfaces is part of what an atlas is, so every atlas raises these in
  // the same words.
  ...KIT_GAP_CONDITIONS,
] as const;

/** One gap condition this atlas can raise. @internal */
export type JumpcloudGapCondition = (typeof JUMPCLOUD_GAP_CONDITIONS)[number];
