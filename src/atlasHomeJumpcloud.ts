/**
 * Where the JumpCloud atlas's generation lives, in a module of its own.
 *
 * The cut `atlasHome.ts` names and `cli/manifests/atlasClerk.ts` set the precedent for: that file grows by
 * one resolver per platform with no ceiling, and it crossed the `file-size-ratchet` cap when the thirty-third
 * atlas landed. Most resolvers cost five lines. This one costs seventy-four, because JumpCloud declares
 * seventy-four kind files and a filename is per-platform and NOT derivable — Cloudflare writes
 * `access-application.json` while Vanta writes `controls.json` for kind `control`, so the record IS the
 * lookup. Moving the one outlier is the cut that buys the most room and touches nobody else's row.
 *
 * `src/__tests__/unit/atlas/jumpcloud/store.test.ts` pins its keys to `JUMPCLOUD_KINDS` exactly, and it
 * reaches this function through `atlas/jumpcloud/store.ts` rather than importing it directly, so the guard
 * did not have to move with it.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the JumpCloud atlas's paths.
 *
 * Seventy-four kind files, one per reachable root in the atlas's generated surface registry, written out
 * rather than derived from a loop. A filename is per-platform and not derivable — Cloudflare writes
 * `access-application.json` while Vanta writes `controls.json` for kind `control` — so this record is the
 * lookup, and `src/__tests__/unit/atlas/jumpcloud/store.test.ts` pins its keys to `JUMPCLOUD_KINDS` exactly.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns the JumpCloud sub-tree
 */
// max-lines-exempt: seventy-four kind filenames as a literal record — a loop over JUMPCLOUD_KINDS would make this file depend on an atlas module, and deriving a name would make the lookup the very thing that is not derivable.
export function jumpcloudAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      accessrequests: "accessrequests.jsonl",
      activedirectories: "activedirectories.jsonl",
      administrators: "administrators.jsonl",
      alerts: "alerts.jsonl",
      "alerts-stats": "alerts-stats.jsonl",
      applemdms: "applemdms.jsonl",
      "application-templates": "application-templates.jsonl",
      applications: "applications.jsonl",
      approvalflowrequest: "approvalflowrequest.jsonl",
      approvalflows: "approvalflows.jsonl",
      approvalflowsettings: "approvalflowsettings.jsonl",
      approversprogress: "approversprogress.jsonl",
      assets: "assets.jsonl",
      authn: "authn.jsonl",
      bulk: "bulk.jsonl",
      cases: "cases.jsonl",
      commandresults: "commandresults.jsonl",
      commands: "commands.jsonl",
      customemail: "customemail.jsonl",
      customemails: "customemails.jsonl",
      devices: "devices.jsonl",
      directories: "directories.jsonl",
      duo: "duo.jsonl",
      events: "events.jsonl",
      "feature-settings": "feature-settings.jsonl",
      featureTrials: "featureTrials.jsonl",
      files: "files.jsonl",
      gcep: "gcep.jsonl",
      "google-emm": "google-emm.jsonl",
      groups: "groups.jsonl",
      gsuites: "gsuites.jsonl",
      healthmonitoring: "healthmonitoring.jsonl",
      "identity-provider": "identity-provider.jsonl",
      identityrisk: "identityrisk.jsonl",
      integrations: "integrations.jsonl",
      iplists: "iplists.jsonl",
      ldapservers: "ldapservers.jsonl",
      logos: "logos.jsonl",
      notifications: "notifications.jsonl",
      "object-storage": "object-storage.jsonl",
      office365s: "office365s.jsonl",
      organizations: "organizations.jsonl",
      "password-manager": "password-manager.jsonl",
      "password-vault": "password-vault.jsonl",
      passwordmanager: "passwordmanager.jsonl",
      passwordmanageritems: "passwordmanageritems.jsonl",
      passwordpolicies: "passwordpolicies.jsonl",
      policies: "policies.jsonl",
      policygroups: "policygroups.jsonl",
      policyresults: "policyresults.jsonl",
      policytemplates: "policytemplates.jsonl",
      "privileged-access": "privileged-access.jsonl",
      providers: "providers.jsonl",
      pushendpoints: "pushendpoints.jsonl",
      queuedcommand: "queuedcommand.jsonl",
      radiusservers: "radiusservers.jsonl",
      reports: "reports.jsonl",
      roles: "roles.jsonl",
      "saas-management": "saas-management.jsonl",
      "saved-views": "saved-views.jsonl",
      "scope-groups": "scope-groups.jsonl",
      search: "search.jsonl",
      "service-accounts": "service-accounts.jsonl",
      software: "software.jsonl",
      softwareapps: "softwareapps.jsonl",
      subscriptions: "subscriptions.jsonl",
      systemgroups: "systemgroups.jsonl",
      systeminsights: "systeminsights.jsonl",
      systems: "systems.jsonl",
      systemusers: "systemusers.jsonl",
      usergroups: "usergroups.jsonl",
      users: "users.jsonl",
      workdays: "workdays.jsonl",
      workflows: "workflows.jsonl",
    },
    platform: "jumpcloud",
  });
}
