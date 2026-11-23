/**
 * Clerk's dashboard navigation surface, and the four rules a walk of it must obey.
 *
 * ## The list came from the dashboard's own navigation, and it is CANDIDATES
 *
 * Clerk publishes no manifest of its dashboard routes. This list was read off the client's own `<a href>`
 * inventory — the account-level shell and the whole Configure tree — and the walk PUBLISHES
 * which of them resolved. A route that does not is a recorded gap on its own row rather than a deletion,
 * which is a fact worth holding: the next session does not have to re-measure it.
 *
 * That is a deliberate design, not a shortcut. A crawler that reported "everything I found" would be making
 * a claim about the crawler; a declared denominator is the only thing that lets a walk say a page is
 * MISSING. `gaps.ts` carries `browser-single-instance-only` as the standing companion admission: the
 * dashboard renders one application and one instance at a time, so this list maps the one the owner's
 * browser is on and no other.
 *
 * ## The application and instance identifiers are never written down HERE
 *
 * A dashboard URL is `dashboard.clerk.com/apps/<application id>/instances/<instance id>/<page>`, and those
 * two segments identify the organisation's own Clerk application — private identifiers this repository may
 * not carry, in source or in a fixture. So every instance page below is a path relative to a root the walk
 * learns at run time from where the client lands.
 *
 * Two places under the PRIVATE state home do hold them, deliberately and stated rather than discovered: the
 * remembered root (`instanceRoot.ts`) and each walked page's own settled URL, which `kit/pageObservation.ts`
 * stores for every walking atlas. Neither is in this repository and neither is ever printed — `walkReport.ts`
 * names the declared surface and its outcome in both report shapes, and `projection.ts` records an instance
 * page's endpoint as `<instance>/<page>`. The line this file draws is the SOURCE and the OUTPUT, which is
 * the line the hygiene gate and a redirected log can actually be held to.
 *
 * ## Landing on the sign-in origin is a LOST SESSION, never a page failure
 *
 * Clerk sends a signed-out browser to its own accounts host. Without that distinction one sign-out becomes
 * forty false page gaps that have nothing to do with the pages, so
 * {@link ./dashboardAddress.js#isClerkSignInUrl} is checked before anything else and the walk stops on it.
 *
 * ## No declared route may DO anything
 *
 * The transport navigates and observes; it performs no click and no form submission. That makes a walk
 * read-only by construction, and this list is the other half of the same property: a route is admissible
 * here only if visiting it is a read. Nothing that signs out, deletes an instance, rotates a key, revokes a
 * session, invites a person or starts a purchase belongs in this file, however interesting its page would
 * be to photograph.
 */
import type { ClerkBrowserPage } from "./dashboardAddress.js";

/**
 * Every dashboard page this atlas declares.
 *
 * Read off the client's own navigation rather than invented, so a surface name here is a place a human can
 * actually be sent. `showsPathPrefix` names the wire-path prefix whose operations this page is the face of,
 * where one exists — it is the §5 join, and a `null` is an honest "this page shows no one API family"
 * rather than an unfilled field.
 */
export const CLERK_BROWSER_PAGES: readonly ClerkBrowserPage[] = [
  {
    description: "every Clerk application this account can open — the shell above any one instance",
    path: "apps",
    root: "account",
    showsPathPrefix: "/v1/platform/applications",
    surface: "account-applications",
  },
  {
    description: "the Clerk account's own settings, above any application",
    path: "settings",
    root: "account",
    showsPathPrefix: null,
    surface: "account-settings",
  },
  {
    description: "who can administer this Clerk account — the dashboard's own membership, not the product's",
    path: "team",
    root: "account",
    showsPathPrefix: null,
    surface: "account-team",
  },
  {
    description: "the instance overview: what the instance is and what has happened on it lately",
    path: "",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-overview",
  },
  {
    description: "the end-user list. Mapped as a PAGE; no row behind it is ever stored",
    path: "users",
    root: "instance",
    showsPathPrefix: "/v1/users",
    surface: "instance-users",
  },
  {
    description: "the organisation list this instance holds",
    path: "organizations",
    root: "instance",
    showsPathPrefix: "/v1/organizations",
    surface: "instance-organizations",
  },
  {
    description: "the organisation settings — what an organisation may be and do on this instance",
    path: "organizations-settings",
    root: "instance",
    showsPathPrefix: "/v1/instance/organization_settings",
    surface: "instance-organization-settings",
  },
  {
    description: "the organisation roles and the permissions each carries",
    path: "organizations-settings/roles",
    root: "instance",
    showsPathPrefix: "/v1/organization_roles",
    surface: "instance-organization-roles",
  },
  {
    description: "user and authentication settings — which identifiers and strategies sign somebody in",
    path: "user-authentication/user-and-authentication",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-user-authentication",
  },
  {
    description: "multi-factor settings — which second factors this instance accepts",
    path: "user-authentication/multi-factor",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-multi-factor",
  },
  {
    description: "restrictions and access mode — who may sign up at all",
    path: "user-authentication/access-mode",
    root: "instance",
    showsPathPrefix: "/v1/instance/protect",
    surface: "instance-access-mode",
  },
  {
    description: "the social and enterprise sign-in connections configured on this instance",
    path: "user-authentication/sso-connections",
    root: "instance",
    showsPathPrefix: "/v1/oauth_applications",
    surface: "instance-sso-connections",
  },
  {
    description: "the enterprise SSO connections — SAML and OIDC, per domain",
    path: "user-authentication/sso-connections/enterprise",
    root: "instance",
    showsPathPrefix: "/v1/enterprise_connections",
    surface: "instance-enterprise-connections",
  },
  {
    description: "Web3 wallet sign-in settings",
    path: "user-authentication/web3",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-web3",
  },
  {
    description: "the allow-list and block-list of identifiers",
    path: "protect/blocklist",
    root: "instance",
    showsPathPrefix: "/v1/blocklist_identifiers",
    surface: "instance-blocklist",
  },
  {
    description: "the attack-protection rules — bot, brute-force and abuse handling",
    path: "protect/rules",
    root: "instance",
    showsPathPrefix: "/v1/instance/protect",
    surface: "instance-protect-rules",
  },
  {
    description: "the sessions settings — lifetime, inactivity and multi-session behaviour",
    path: "sessions",
    root: "instance",
    showsPathPrefix: "/v1/sessions",
    surface: "instance-sessions",
  },
  {
    description: "the JWT templates this instance mints session tokens from",
    path: "jwt-templates",
    root: "instance",
    showsPathPrefix: "/v1/jwt_templates",
    surface: "instance-jwt-templates",
  },
  {
    description: "the publishable and secret API keys, and where each is used. Photographed, never read",
    path: "api-keys",
    root: "instance",
    showsPathPrefix: "/v1/api_keys",
    surface: "instance-api-keys",
  },
  {
    description: "machine-to-machine authentication — the machines this instance mints tokens for",
    path: "machines",
    root: "instance",
    showsPathPrefix: "/v1/machines",
    surface: "instance-machines",
  },
  {
    description: "the OAuth applications this instance is an identity provider for",
    path: "oauth-applications",
    root: "instance",
    showsPathPrefix: "/v1/oauth_applications",
    surface: "instance-oauth-applications",
  },
  {
    description: "the platform API keys this account holds",
    path: "platform/api-keys",
    root: "instance",
    showsPathPrefix: "/v1/platform",
    surface: "instance-platform-api-keys",
  },
  {
    description: "the domains this instance answers on, and their DNS status",
    path: "domains",
    root: "instance",
    showsPathPrefix: "/v1/domains",
    surface: "instance-domains",
  },
  {
    description: "the paths the account portal and the application redirect between",
    path: "paths",
    root: "instance",
    showsPathPrefix: "/v1/redirect_urls",
    surface: "instance-paths",
  },
  {
    description: "the account portal — Clerk's own hosted sign-in and profile pages for this instance",
    path: "account-portal",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-account-portal",
  },
  {
    description: "native application settings — the mobile and desktop clients this instance admits",
    path: "native-applications",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-native-applications",
  },
  {
    description: "the email templates this instance sends from",
    path: "customization/email",
    root: "instance",
    showsPathPrefix: "/v1/templates",
    surface: "instance-email-templates",
  },
  {
    description: "the SMS templates this instance sends from",
    path: "customization/sms",
    root: "instance",
    showsPathPrefix: "/v1/templates",
    surface: "instance-sms-templates",
  },
  {
    description: "avatar and branding settings",
    path: "customization/avatars",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-avatars",
  },
  {
    description: "the webhook endpoints this instance posts events to",
    path: "webhooks",
    root: "instance",
    showsPathPrefix: "/v1/webhooks",
    surface: "instance-webhooks",
  },
  {
    description: "the integrations installed on this instance — the page, never a shot per installed app",
    path: "integrations",
    root: "instance",
    showsPathPrefix: null,
    surface: "instance-integrations",
  },
  {
    description: "the feature flags and entitlements this instance's plan opens",
    path: "features",
    root: "instance",
    showsPathPrefix: null,
    surface: "instance-features",
  },
  {
    description: "the instance's own settings — name, environment and deletion controls",
    path: "instance-settings",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-settings",
  },
  {
    description: "the billing subscription this instance's product bills its own users under",
    path: "billing/subscriptions",
    root: "instance",
    showsPathPrefix: "/v1/billing",
    surface: "instance-billing-subscriptions",
  },
  {
    description: "the billing plans this instance offers its own users",
    path: "billing/plans",
    root: "instance",
    showsPathPrefix: "/v1/billing/plans",
    surface: "instance-billing-plans",
  },
  {
    description: "the billing discounts configured on this instance",
    path: "billing/discounts",
    root: "instance",
    showsPathPrefix: "/v1/billing",
    surface: "instance-billing-discounts",
  },
  {
    description: "the billing settings — the gateway and the currency this instance bills in",
    path: "billing/settings",
    root: "instance",
    showsPathPrefix: "/v1/billing",
    surface: "instance-billing-settings",
  },
  {
    description: "the legal and compliance settings — terms and privacy acceptance",
    path: "compliance/legal",
    root: "instance",
    showsPathPrefix: "/v1/instance",
    surface: "instance-compliance-legal",
  },
  {
    description: "the application logs — request and error telemetry, photographed and never stored as rows",
    path: "application-logs",
    root: "instance",
    showsPathPrefix: null,
    surface: "instance-application-logs",
  },
  {
    description: "the instance's own update and deployment feed",
    path: "updates",
    root: "instance",
    showsPathPrefix: null,
    surface: "instance-updates",
  },
];

/**
 * Every declared page's surface name, which is the walk's denominator.
 *
 * @returns the surface names, in declaration order
 *
 * @internal
 */
export function clerkDeclaredPageSurfaces(): readonly string[] {
  return CLERK_BROWSER_PAGES.map((page) => page.surface);
}
