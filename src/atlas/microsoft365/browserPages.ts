/**
 * The Microsoft admin consoles' navigation surface — every page this atlas declares, across seven consoles.
 *
 * ## Nothing in this file has been visited, and it says so rather than implying otherwise
 *
 * Every route below is taken from the consoles' own navigation and deep-link scheme, not from a walk. No page
 * here has been reached, photographed or graded, the `admin-consoles` surface is `declared-unfilled` in the
 * descriptor for exactly that reason, and each declared page carries a `browser-page-not-attempted` gap until
 * a walk changes it. The sibling Notion atlas is the cautionary case in the other direction: its first list
 * was written from the same kind of reasonable inference and a live walk reached ONE page of thirty-one.
 * Expect this list to be wrong in the same way and to be corrected by measurement, which is what the walk is
 * for.
 *
 * ## The list NEVER SHRINKS — the owner's rule
 *
 * The atlas covers the WHOLE browser surface, never a subset. A route that turns out to be
 * unreachable is recorded as a GAP against the page, never deleted from this file: an atlas that quietly
 * drops what it could not reach reports a smaller platform rather than a partial look at a large one, which
 * is the exact dishonesty coverage exists to prevent.
 *
 * ## The one thing that would surprise a reader, stated before it is discovered
 *
 * The Entra and Intune consoles address a page in the URL FRAGMENT (`#view/<extension>/<blade>`), which is
 * never sent to the server. So HTTP status cannot grade reachability on those two consoles at all — a page
 * that does not exist answers 200 and renders an error inside the app, exactly the shape that made the first
 * Notion walk report twenty-one reached pages that were all one not-found shell. A walk here must grade on
 * the rendered title and on what the console's own API calls returned, and `browserWalkGrading` below is
 * where that judgement will live when the walk lands.
 *
 * ## The SharePoint console cannot be addressed from this repository at all
 *
 * Its host is `<tenant>-admin.sharepoint.com`, and that segment is the organisation's own name — a private
 * identifier this repository may not carry, in source or in a fixture. So its pages declare a `tenant-root`
 * console whose origin is learned at run time from where the browser lands, and the name exists nowhere here.
 * That is the same mechanism `notion/browserPages.ts` uses for the workspace slug, and it is a constraint
 * this atlas inherits rather than a limitation of the console.
 */

/**
 * The consoles this atlas declares, and the origin each is addressed at.
 *
 * `tenant-root` is deliberately absent: the SharePoint admin console's origin embeds the organisation name
 * and is resolved at run time — see this file's header.
 */
export const MICROSOFT365_CONSOLE_ORIGINS = {
  entra: "https://entra.microsoft.com",
  exchange: "https://admin.exchange.microsoft.com",
  intune: "https://intune.microsoft.com",
  "microsoft365-admin": "https://admin.microsoft.com",
  purview: "https://purview.microsoft.com",
  security: "https://security.microsoft.com",
  teams: "https://admin.teams.microsoft.com",
} as const;

/**
 * One console this atlas declares pages under.
 *
 * @internal
 */
export type Microsoft365Console = keyof typeof MICROSOFT365_CONSOLE_ORIGINS | "tenant-root";

/**
 * One declared page: where it is, what it shows, and what it takes to see it.
 *
 * @internal
 */
export interface Microsoft365BrowserPage {
  /** Which console it belongs to. */
  readonly console: Microsoft365Console;
  /** A stable name for the page, used as its provider key and never derived from the URL. */
  readonly surface: string;
  /** The path or fragment, relative to the console's origin. */
  readonly path: string;
  /** What a reader learns from this page that no other page gives them. */
  readonly description: string;
  /**
   * The directory role or licence this page is believed to need, or `null` when it is open to any signed-in
   * administrator. A BELIEF until a walk measures it, and recorded so a 403 can be read as an expected
   * ceiling rather than as a broken route.
   */
  readonly believedToNeed: string | null;
}

/**
 * Every page this atlas declares. Grouped by console, in the order each console's own navigation lists them.
 *
 * The Entra pages come first and are the longest run, which is the shape of the platform rather than an
 * emphasis: nothing else in this installation holds the directory, so the directory's own console is where
 * the atlas's question is answered.
 */
export const MICROSOFT365_BROWSER_PAGES: readonly Microsoft365BrowserPage[] = [
  // --- Microsoft Entra admin centre: identity, the reason this atlas exists ---
  {
    believedToNeed: null,
    console: "entra",
    description: "the tenant overview — tenant id, licence edition and the top-level identity summary",
    path: "#view/Microsoft_AAD_IAM/TenantOverview.ReactView",
    surface: "entra-overview",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every user account in the directory, the roster the whole atlas is anchored on",
    path: "#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers",
    surface: "entra-users",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "recently deleted users, which the directory keeps for thirty days and the API also exposes",
    path: "#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/DeletedUsers",
    surface: "entra-deleted-users",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "user settings — who may register applications, and what a guest can see",
    path: "#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/UserSettings",
    surface: "entra-user-settings",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every group, with its membership type and source of authority",
    path: "#view/Microsoft_AAD_IAM/GroupsManagementMenuBlade/~/AllGroups",
    surface: "entra-groups",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "group settings — who may create groups, and the expiration policy",
    path: "#view/Microsoft_AAD_IAM/GroupsManagementMenuBlade/~/General",
    surface: "entra-group-settings",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every registered device and its join type, which is the other half of the fleet picture",
    path: "#view/Microsoft_AAD_Devices/DevicesMenuBlade/~/Devices",
    surface: "entra-devices",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "device settings — who may join devices, and the local administrator policy",
    path: "#view/Microsoft_AAD_Devices/DevicesMenuBlade/~/DeviceSettings",
    surface: "entra-device-settings",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every enterprise application, which is where SSO assignments actually live",
    path: "#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview",
    surface: "entra-enterprise-applications",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every app registration, its credentials' expiry and its API permissions",
    path: "#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    surface: "entra-app-registrations",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "user consent and admin consent settings — the standing answer to what an app may be granted",
    path: "#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/UserSettings",
    surface: "entra-consent-settings",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every directory role and who currently holds it, permanently rather than through PIM",
    path: "#view/Microsoft_AAD_IAM/RolesManagementMenuBlade/~/AllRoles",
    surface: "entra-roles",
  },
  {
    believedToNeed: "Privileged Role Administrator",
    console: "entra",
    description: "Privileged Identity Management — eligible against active role assignments, which no roles page shows",
    path: "#view/Microsoft_Azure_PIMCommon/CommonMenuBlade/~/quickStart",
    surface: "entra-pim",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "every Conditional Access policy, the control that decides who gets in from where",
    path: "#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies",
    surface: "entra-conditional-access",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "named locations, which Conditional Access policies refer to and which no policy page shows",
    path: "#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/NamedLocations",
    surface: "entra-named-locations",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "authentication strengths — the combinations a policy may demand",
    path: "#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/AuthStrengths",
    surface: "entra-authentication-strengths",
  },
  {
    believedToNeed: "Authentication Policy Administrator",
    console: "entra",
    description: "authentication methods policy — which factors are enabled and for whom",
    path: "#view/Microsoft_AAD_IAM/AuthenticationMethodsMenuBlade/~/AdminAuthMethods",
    surface: "entra-authentication-methods",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "self-service password reset configuration",
    path: "#view/Microsoft_AAD_IAM/PasswordResetMenuBlade/~/Properties",
    surface: "entra-password-reset",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "custom domain names and their verification state",
    path: "#view/Microsoft_AAD_IAM/DomainsManagementBlade",
    surface: "entra-domains",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "tenant properties — the technical contact, the privacy statement and the security defaults toggle",
    path: "#view/Microsoft_AAD_IAM/TenantPropertiesBlade",
    surface: "entra-tenant-properties",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "external identities — whether a guest can be invited, and by whom",
    path: "#view/Microsoft_AAD_IAM/CompanyRelationshipsMenuBlade/~/Settings",
    surface: "entra-external-identities",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "cross-tenant access settings — the inbound and outbound trust with other organisations",
    path: "#view/Microsoft_AAD_IAM/CompanyRelationshipsMenuBlade/~/CrossTenantAccessSettings",
    surface: "entra-cross-tenant-access",
  },
  {
    believedToNeed: "Identity Governance Administrator",
    console: "entra",
    description: "access reviews — the recurring attestation that someone still needs what they hold",
    path: "#view/Microsoft_AAD_ERM/DashboardBlade/~/Controls",
    surface: "entra-access-reviews",
  },
  {
    believedToNeed: "Identity Governance Administrator",
    console: "entra",
    description: "entitlement management access packages, which grant bundles of access on request",
    path: "#view/Microsoft_AAD_ERM/DashboardBlade/~/elmEntitlement",
    surface: "entra-entitlement-management",
  },
  {
    believedToNeed: "Identity Governance Administrator",
    console: "entra",
    description: "lifecycle workflows — what happens automatically when somebody joins, moves or leaves",
    path: "#view/Microsoft_AAD_LifecycleManagement/WorkflowsMenuBlade",
    surface: "entra-lifecycle-workflows",
  },
  {
    believedToNeed: "Security Reader",
    console: "entra",
    description: "risky users, which Identity Protection maintains as a rolling state rather than a log",
    path: "#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskyUsers",
    surface: "entra-risky-users",
  },
  {
    believedToNeed: "Security Reader",
    console: "entra",
    description: "risk detections, the observation stream behind those users",
    path: "#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskDetections",
    surface: "entra-risk-detections",
  },
  {
    believedToNeed: "Reports Reader",
    console: "entra",
    description: "the sign-in log, and the filters the console offers over it",
    path: "#view/Microsoft_AAD_IAM/SignInEventsV3Blade",
    surface: "entra-sign-in-logs",
  },
  {
    believedToNeed: "Reports Reader",
    console: "entra",
    description: "the directory audit log — every change to the directory itself",
    path: "#view/Microsoft_AAD_IAM/AuditLogsBlade",
    surface: "entra-audit-logs",
  },
  {
    believedToNeed: "Reports Reader",
    console: "entra",
    description: "provisioning logs, which are where an SSO or SCIM sync failure is actually visible",
    path: "#view/Microsoft_AAD_IAM/ProvisioningEventsBlade",
    surface: "entra-provisioning-logs",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "diagnostic settings — where the logs above are being shipped, if anywhere",
    path: "#view/Microsoft_AAD_IAM/DiagnosticSettingsBlade",
    surface: "entra-diagnostic-settings",
  },
  {
    believedToNeed: null,
    console: "entra",
    description: "licences assigned in the directory, as Entra rather than the billing console sees them",
    path: "#view/Microsoft_AAD_IAM/LicensesMenuBlade/~/Products",
    surface: "entra-licences",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "company branding, which is what a person actually sees at the sign-in page",
    path: "#view/Microsoft_AAD_IAM/CompanyBrandingMenuBlade",
    surface: "entra-company-branding",
  },
  {
    believedToNeed: "Global Administrator",
    console: "entra",
    description: "terms of use, the agreements a Conditional Access policy can require acceptance of",
    path: "#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Agreements",
    surface: "entra-terms-of-use",
  },

  // --- Microsoft 365 admin centre: the licence and service picture Entra does not hold ---
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "the admin home, whose cards name which services this tenant actually has",
    path: "#/homepage",
    surface: "m365-home",
  },
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "active users as the 365 console sees them, with their assigned products",
    path: "#/users",
    surface: "m365-active-users",
  },
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "guest users, which the 365 console lists separately from members",
    path: "#/guests",
    surface: "m365-guest-users",
  },
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "teams and groups, including the shared mailboxes and distribution lists Entra does not show",
    path: "#/groups",
    surface: "m365-groups",
  },
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "admin role assignments as the 365 console presents them, which differs from Entra's own view",
    path: "#/adminRoles",
    surface: "m365-roles",
  },
  {
    believedToNeed: "Billing Administrator",
    console: "microsoft365-admin",
    description: "subscriptions and their seat counts — what this organisation is actually paying for",
    path: "#/subscriptions",
    surface: "m365-subscriptions",
  },
  {
    believedToNeed: "Billing Administrator",
    console: "microsoft365-admin",
    description: "licence assignment, seat by seat",
    path: "#/licenses",
    surface: "m365-licences",
  },
  {
    believedToNeed: "Global Administrator",
    console: "microsoft365-admin",
    description: "organisation settings for each service — the per-service configuration surface",
    path: "#/Settings/Services",
    surface: "m365-org-settings-services",
  },
  {
    believedToNeed: "Global Administrator",
    console: "microsoft365-admin",
    description: "organisation security and privacy settings, including the password expiry policy",
    path: "#/Settings/SecurityPrivacy",
    surface: "m365-org-settings-security",
  },
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "service health — whether an incident this organisation is feeling is Microsoft's",
    path: "#/servicehealth",
    surface: "m365-service-health",
  },
  {
    believedToNeed: null,
    console: "microsoft365-admin",
    description: "the message centre, which is where a change to this tenant is announced before it happens",
    path: "#/MessageCenter",
    surface: "m365-message-centre",
  },
  {
    believedToNeed: "Reports Reader",
    console: "microsoft365-admin",
    description: "usage reports — the console's own rendering of the voluminous reporting family",
    path: "#/reportsUsage",
    surface: "m365-usage-reports",
  },

  // --- Exchange admin centre ---
  {
    believedToNeed: "Exchange Administrator",
    console: "exchange",
    description: "every mailbox, which is the recipient roster mail flow actually resolves against",
    path: "#/mailboxes",
    surface: "exchange-mailboxes",
  },
  {
    believedToNeed: "Exchange Administrator",
    console: "exchange",
    description: "mail flow rules — the transport rules that rewrite, block or route mail",
    path: "#/transportrules",
    surface: "exchange-mail-flow-rules",
  },
  {
    believedToNeed: "Exchange Administrator",
    console: "exchange",
    description: "connectors, which decide what may relay mail as this organisation",
    path: "#/connectors",
    surface: "exchange-connectors",
  },
  {
    believedToNeed: "Exchange Administrator",
    console: "exchange",
    description: "accepted domains, as Exchange rather than Entra records them",
    path: "#/accepteddomains",
    surface: "exchange-accepted-domains",
  },
  {
    believedToNeed: "Exchange Administrator",
    console: "exchange",
    description: "remote domains and the settings applied to mail leaving for them",
    path: "#/remotedomains",
    surface: "exchange-remote-domains",
  },
  {
    believedToNeed: "Exchange Administrator",
    console: "exchange",
    description: "Exchange role groups, a permission surface that is not the directory's",
    path: "#/adminRoles",
    surface: "exchange-role-groups",
  },

  // --- Teams admin centre ---
  {
    believedToNeed: "Teams Administrator",
    console: "teams",
    description: "every team, with its privacy setting and owner count",
    path: "#/teams/manage",
    surface: "teams-manage-teams",
  },
  {
    believedToNeed: "Teams Administrator",
    console: "teams",
    description: "teams policies, which decide what a member may do inside a team",
    path: "#/teams/teamspolicies",
    surface: "teams-policies",
  },
  {
    believedToNeed: "Teams Administrator",
    console: "teams",
    description: "meeting policies, including recording and lobby behaviour",
    path: "#/meetings/meetingpolicies",
    surface: "teams-meeting-policies",
  },
  {
    believedToNeed: "Teams Administrator",
    console: "teams",
    description: "messaging policies",
    path: "#/messaging/messagingpolicies",
    surface: "teams-messaging-policies",
  },
  {
    believedToNeed: "Teams Administrator",
    console: "teams",
    description: "external access and guest access — who outside this organisation may reach it in Teams",
    path: "#/company-wide-settings/external-communications",
    surface: "teams-external-access",
  },

  // --- Intune / endpoint management ---
  {
    believedToNeed: "Intune Administrator",
    console: "intune",
    description: "every enrolled device, the other half of the fleet picture beside the directory's",
    path: "#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/mDMDevices",
    surface: "intune-devices",
  },
  {
    believedToNeed: "Intune Administrator",
    console: "intune",
    description: "compliance policies — the standard a device has to meet before Conditional Access lets it in",
    path: "#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/compliance",
    surface: "intune-compliance-policies",
  },
  {
    believedToNeed: "Intune Administrator",
    console: "intune",
    description: "configuration profiles, which are what is actually pushed to a device",
    path: "#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/configureProfiles",
    surface: "intune-configuration-profiles",
  },
  {
    believedToNeed: "Intune Administrator",
    console: "intune",
    description: "enrolment configuration — how a device gets into management in the first place",
    path: "#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/enrollment",
    surface: "intune-enrolment",
  },
  {
    believedToNeed: "Intune Administrator",
    console: "intune",
    description: "managed applications and their assignment",
    path: "#view/Microsoft_Intune_DeviceSettings/AppsMenu/~/allApps",
    surface: "intune-apps",
  },
  {
    believedToNeed: "Intune Administrator",
    console: "intune",
    description: "endpoint security baselines and policies",
    path: "#view/Microsoft_Intune_Workflows/SecurityManagementMenu/~/overview",
    surface: "intune-endpoint-security",
  },

  // --- Microsoft 365 Defender / security portal ---
  {
    believedToNeed: "Security Reader",
    console: "security",
    description: "incidents and alerts, the security console's own front door",
    path: "/incidents",
    surface: "security-incidents",
  },
  {
    believedToNeed: "Security Reader",
    console: "security",
    description: "secure score, and the controls it is scoring",
    path: "/securescore",
    surface: "security-secure-score",
  },
  {
    believedToNeed: "Security Administrator",
    console: "security",
    description: "threat policies — anti-phishing, anti-spam and safe links, which are configuration",
    path: "/threatpolicy",
    surface: "security-threat-policies",
  },
  {
    believedToNeed: "Security Administrator",
    console: "security",
    description: "device onboarding and endpoint settings for Defender",
    path: "/securitysettings/endpoints/onboarding",
    surface: "security-endpoint-onboarding",
  },

  // --- Purview / compliance ---
  {
    believedToNeed: "Compliance Administrator",
    console: "purview",
    description: "data loss prevention policies",
    path: "/datalossprevention/policies",
    surface: "purview-dlp-policies",
  },
  {
    believedToNeed: "Compliance Administrator",
    console: "purview",
    description: "sensitivity labels and their publishing policies",
    path: "/informationprotection/labels",
    surface: "purview-sensitivity-labels",
  },
  {
    believedToNeed: "Compliance Administrator",
    console: "purview",
    description: "retention policies and labels",
    path: "/datalifecyclemanagement/retention",
    surface: "purview-retention",
  },
  {
    believedToNeed: "Audit Reader",
    console: "purview",
    description: "the unified audit log search — the console face of the voluminous audit family",
    path: "/audit/auditsearch",
    surface: "purview-audit-search",
  },

  // --- SharePoint admin centre: origin resolved at run time, never written down ---
  {
    believedToNeed: "SharePoint Administrator",
    console: "tenant-root",
    description: "every SharePoint site collection, which is where file sharing is actually governed",
    path: "_layouts/15/online/AdminHome.aspx#/siteManagement",
    surface: "sharepoint-sites",
  },
  {
    believedToNeed: "SharePoint Administrator",
    console: "tenant-root",
    description: "external sharing policy for SharePoint and OneDrive",
    path: "_layouts/15/online/AdminHome.aspx#/sharing",
    surface: "sharepoint-sharing-policy",
  },
  {
    believedToNeed: "SharePoint Administrator",
    console: "tenant-root",
    description: "access control settings — unmanaged devices, idle session sign-out and network location",
    path: "_layouts/15/online/AdminHome.aspx#/accessControl",
    surface: "sharepoint-access-control",
  },
];

/**
 * The address a declared page is reached at.
 *
 * A leading `/` on a path is dropped before the join, because two of the seven consoles route on the path and
 * five route on the fragment, and a template that assumed one shape produced `purview.microsoft.com//…` for
 * the other. Caught by reading a published generation rather than by review, which is the argument for
 * publishing a declaration before a walk exists to consume it.
 *
 * @param page the declared page
 * @returns the absolute URL, or `null` for a page on a console whose origin embeds the organisation name and
 *   is therefore resolved at run time rather than written here
 */
export function microsoft365PageUrl({ page }: { page: Microsoft365BrowserPage }): string | null {
  if (page.console === "tenant-root") {
    return null;
  }
  const origin = MICROSOFT365_CONSOLE_ORIGINS[page.console];
  const suffix = page.path.startsWith("/") ? page.path.slice(1) : page.path;
  return `${origin}/${suffix}`;
}

/**
 * Whether a console addresses its pages in the URL fragment, which makes an HTTP status meaningless for
 * grading reachability.
 *
 * Named rather than inferred because it is the one property that decides how a walk may grade this surface —
 * see this file's header on the twenty-one identical Notion screenshots.
 *
 * @param console the console to ask about
 * @returns whether its routes live in the fragment
 */
export function microsoft365ConsoleIsFragmentRouted({ console }: { console: Microsoft365Console }): boolean {
  return console === "entra" || console === "intune" || console === "microsoft365-admin";
}
