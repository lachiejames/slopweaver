/**
 * How a Graph path becomes a kind, an alias and a provider key.
 *
 * Every function here is pure and total over a path template, so the whole naming layer is testable without
 * the 44 MB document it is normally fed. Nothing here invents a name: the kind is Graph's own first path
 * segment and the provider key is the method and the path exactly as the specification writes them, because
 * a key this repository derived rather than copied is a key that stops matching the day Microsoft renames
 * something.
 */
import { MICROSOFT365_KINDS, type Microsoft365Kind } from "./model.js";

/** Graph's `/me` root, which addresses the signed-in principal rather than a resource collection. */
const ME_ROOT = "/me";

/** The `/users/{user-id}` prefix every `/me` operation has a counterpart under, when one exists. */
const USER_PREFIX = "/users/{user-id}";

/**
 * The kind one path belongs to: Graph's own first path segment.
 *
 * An OData function in the first segment carries its arguments in parentheses — `/reports/getX(period='p')`
 * has the root `reports`, but a root-level function such as `/directoryObjects(...)` must not become a kind
 * called `directoryObjects(...)`. So the parenthesised tail is cut before the segment is read.
 *
 * @param pathShape the specification's own path key
 * @returns the kind, or `null` when the first segment is not one this atlas declares
 */
export function microsoft365KindOf({ pathShape }: { pathShape: string }): Microsoft365Kind | null {
  const segment = microsoft365RootSegmentOf({ pathShape });
  if (segment === null) {
    return null;
  }
  const found = MICROSOFT365_KINDS.find((kind) => kind === segment);
  // A root this build declares no kind for is exactly what the compile must be able to NAME, so a miss is an
  // answer — `null` — and the caller lists the segment as an unknown root rather than dropping its rows.
  if (found === undefined) {
    return null;
  }
  return found;
}

/**
 * Graph's own first path segment, whether or not this build declares a kind for it.
 *
 * Separate from {@link microsoft365KindOf} because the two questions differ: a compile has to be able to NAME
 * a root it does not recognise, so that a workload Microsoft added becomes a refusal rather than a silently
 * shorter surface. An OData function in the first segment carries its arguments in parentheses, so the
 * parenthesised tail is cut before the segment is read.
 *
 * @param pathShape the specification's own path key
 * @returns the first segment, or `null` when the path has none
 */
export function microsoft365RootSegmentOf({ pathShape }: { pathShape: string }): string | null {
  const segment = pathShape.split("/")[1];
  if (segment === undefined) {
    return null;
  }
  // `split` always yields at least one element, so the first is present whether or not a `(` was found.
  return segment.split("(")[0]!;
}

/**
 * The provider's own key for one operation: the method and the path, joined by a space.
 *
 * Byte-exact rather than derived, because this is what the three channels are matched on. A compiled row and
 * a live Graph observation of the same endpoint must fold onto one entity, and the only thing both can
 * produce without agreeing on a naming scheme is the pair the request itself carries.
 *
 * @param method the HTTP method
 * @param pathShape the specification's own path key
 * @returns `<METHOD> <path>`
 */
export function microsoft365ProviderId({ method, pathShape }: { method: string; pathShape: string }): string {
  return `${method.toUpperCase()} ${pathShape}`;
}

/**
 * The `/users/{user-id}` address a `/me` path aliases.
 *
 * `/me` is not a second surface — it is the same data at a second address, and recording which address it
 * duplicates is what keeps that from reading as 863 extra operations nobody can account for. The caller
 * supplies the set of paths the document actually declares, so an alias is only claimed when the counterpart
 * genuinely exists: several `/me` operations have no `/users/{user-id}` twin.
 *
 * @param pathShape the specification's own path key
 * @param declaredPaths every path key the document declares, for the existence check
 * @returns the counterpart path, or `null` when this is not a `/me` path or the counterpart is absent
 */
export function microsoft365AliasOf({
  pathShape,
  declaredPaths,
}: {
  pathShape: string;
  declaredPaths: ReadonlySet<string>;
}): string | null {
  if (pathShape !== ME_ROOT && !pathShape.startsWith(`${ME_ROOT}/`)) {
    return null;
  }
  const candidate = `${USER_PREFIX}${pathShape.slice(ME_ROOT.length)}`;
  return declaredPaths.has(candidate) ? candidate : null;
}

/**
 * The pagination style one operation declares, read from its parameter names.
 *
 * Graph is OData, so a collection GET declares `$top` and `$skip` (or `$skiptoken`) and a single-entity GET
 * declares neither. Recorded because "can this be paged, and how" is the first thing a caller has to know and
 * the last thing a path shape tells them.
 *
 * @param parameterNames every parameter name the operation declares
 * @returns `odata-top-skip`, `odata-skip-token`, or `none`
 */
export function microsoft365PaginationOf({ parameterNames }: { parameterNames: readonly string[] }): string {
  const names = new Set(parameterNames);
  if (names.has("$skiptoken")) {
    return "odata-skip-token";
  }
  if (names.has("$top") || names.has("$skip")) {
    return "odata-top-skip";
  }
  return "none";
}

/**
 * The admin-centre URL that proves one kind to a human, when this atlas knows one.
 *
 * Deliberately per-KIND rather than per-operation: Graph does not publish a portal address for an endpoint,
 * and constructing one from a path shape would be inventing a link rather than knowing one. A kind with no
 * known console page gets `null`, and the source's `deepLinkStatus` says `unavailable` rather than pretending
 * nobody looked.
 *
 * @param kind the kind to locate in a console
 * @returns the console URL, or `null` when none is known for this kind
 */
export function microsoft365ConsoleLinkFor({ kind }: { kind: Microsoft365Kind }): string | null {
  const link = CONSOLE_LINKS[kind];
  if (link === undefined) {
    return null;
  }
  return link;
}

/**
 * The console addresses this atlas actually knows, keyed by kind.
 *
 * Hand-written from the admin centres' own navigation, one entry at a time — every one of them is a page the
 * browser surface also declares (`browserPages.ts`), so the two halves agree by construction rather than by
 * a reader noticing they do not.
 */
const CONSOLE_LINKS: Readonly<Partial<Record<Microsoft365Kind, string>>> = {
  applications: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/AppRegistrationsPreview",
  auditLogs: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/AuditLogsBlade",
  deviceManagement: "https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesMenu",
  devices: "https://entra.microsoft.com/#view/Microsoft_AAD_Devices/DevicesMenuBlade",
  directoryRoles: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RolesManagementMenuBlade",
  domains: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/DomainsManagementBlade",
  groups: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupsManagementMenuBlade",
  identityProtection: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade",
  organization: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/TenantPropertiesBlade",
  policies: "https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade",
  reports: "https://admin.microsoft.com/#/reportsUsage",
  roleManagement: "https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/CommonMenuBlade",
  security: "https://security.microsoft.com/homepage",
  servicePrincipals: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade",
  subscribedSkus: "https://admin.microsoft.com/#/subscriptions",
  users: "https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade",
};
