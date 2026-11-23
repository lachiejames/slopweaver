/**
 * The JumpCloud atlas's paths under a literal atlas root: its platform directory, manifest, sensitive
 * companion and superseded archive slot, and every one of the seventy-four kind files — hyphenated keys and
 * the case-sensitive `featureTrials` included — written out here rather than derived from the kind list or
 * the function under test, so a renamed or dropped kind file is a visible change.
 */
import { describe, expect, it } from "vitest";

import { jumpcloudAtlasPaths } from "../../atlasHomeJumpcloud.js";

const DIR = "/h/atlas/jumpcloud";

const EXPECTED_KINDS = {
  accessrequests: `${DIR}/accessrequests.jsonl`,
  activedirectories: `${DIR}/activedirectories.jsonl`,
  administrators: `${DIR}/administrators.jsonl`,
  alerts: `${DIR}/alerts.jsonl`,
  "alerts-stats": `${DIR}/alerts-stats.jsonl`,
  applemdms: `${DIR}/applemdms.jsonl`,
  "application-templates": `${DIR}/application-templates.jsonl`,
  applications: `${DIR}/applications.jsonl`,
  approvalflowrequest: `${DIR}/approvalflowrequest.jsonl`,
  approvalflows: `${DIR}/approvalflows.jsonl`,
  approvalflowsettings: `${DIR}/approvalflowsettings.jsonl`,
  approversprogress: `${DIR}/approversprogress.jsonl`,
  assets: `${DIR}/assets.jsonl`,
  authn: `${DIR}/authn.jsonl`,
  bulk: `${DIR}/bulk.jsonl`,
  cases: `${DIR}/cases.jsonl`,
  commandresults: `${DIR}/commandresults.jsonl`,
  commands: `${DIR}/commands.jsonl`,
  customemail: `${DIR}/customemail.jsonl`,
  customemails: `${DIR}/customemails.jsonl`,
  devices: `${DIR}/devices.jsonl`,
  directories: `${DIR}/directories.jsonl`,
  duo: `${DIR}/duo.jsonl`,
  events: `${DIR}/events.jsonl`,
  "feature-settings": `${DIR}/feature-settings.jsonl`,
  featureTrials: `${DIR}/featureTrials.jsonl`,
  files: `${DIR}/files.jsonl`,
  gcep: `${DIR}/gcep.jsonl`,
  "google-emm": `${DIR}/google-emm.jsonl`,
  groups: `${DIR}/groups.jsonl`,
  gsuites: `${DIR}/gsuites.jsonl`,
  healthmonitoring: `${DIR}/healthmonitoring.jsonl`,
  "identity-provider": `${DIR}/identity-provider.jsonl`,
  identityrisk: `${DIR}/identityrisk.jsonl`,
  integrations: `${DIR}/integrations.jsonl`,
  iplists: `${DIR}/iplists.jsonl`,
  ldapservers: `${DIR}/ldapservers.jsonl`,
  logos: `${DIR}/logos.jsonl`,
  notifications: `${DIR}/notifications.jsonl`,
  "object-storage": `${DIR}/object-storage.jsonl`,
  office365s: `${DIR}/office365s.jsonl`,
  organizations: `${DIR}/organizations.jsonl`,
  "password-manager": `${DIR}/password-manager.jsonl`,
  "password-vault": `${DIR}/password-vault.jsonl`,
  passwordmanager: `${DIR}/passwordmanager.jsonl`,
  passwordmanageritems: `${DIR}/passwordmanageritems.jsonl`,
  passwordpolicies: `${DIR}/passwordpolicies.jsonl`,
  policies: `${DIR}/policies.jsonl`,
  policygroups: `${DIR}/policygroups.jsonl`,
  policyresults: `${DIR}/policyresults.jsonl`,
  policytemplates: `${DIR}/policytemplates.jsonl`,
  "privileged-access": `${DIR}/privileged-access.jsonl`,
  providers: `${DIR}/providers.jsonl`,
  pushendpoints: `${DIR}/pushendpoints.jsonl`,
  queuedcommand: `${DIR}/queuedcommand.jsonl`,
  radiusservers: `${DIR}/radiusservers.jsonl`,
  reports: `${DIR}/reports.jsonl`,
  roles: `${DIR}/roles.jsonl`,
  "saas-management": `${DIR}/saas-management.jsonl`,
  "saved-views": `${DIR}/saved-views.jsonl`,
  "scope-groups": `${DIR}/scope-groups.jsonl`,
  search: `${DIR}/search.jsonl`,
  "service-accounts": `${DIR}/service-accounts.jsonl`,
  software: `${DIR}/software.jsonl`,
  softwareapps: `${DIR}/softwareapps.jsonl`,
  subscriptions: `${DIR}/subscriptions.jsonl`,
  systemgroups: `${DIR}/systemgroups.jsonl`,
  systeminsights: `${DIR}/systeminsights.jsonl`,
  systems: `${DIR}/systems.jsonl`,
  systemusers: `${DIR}/systemusers.jsonl`,
  usergroups: `${DIR}/usergroups.jsonl`,
  users: `${DIR}/users.jsonl`,
  workdays: `${DIR}/workdays.jsonl`,
  workflows: `${DIR}/workflows.jsonl`,
};

describe("jumpcloudAtlasPaths", () => {
  it("lays out the platform directory, manifest, sensitive companion and superseded slot", () => {
    const paths = jumpcloudAtlasPaths({ atlasRoot: "/h/atlas" });

    expect(paths.root).toBe("/h/atlas/jumpcloud");
    expect(paths.manifest).toBe("/h/atlas/jumpcloud/manifest.json");
    expect(paths.sensitive).toBe("/h/atlas/jumpcloud/_sensitive");
    expect(paths.superseded).toBe("/h/atlas/_superseded/jumpcloud");
  });

  it("maps all seventy-four kinds to their own jsonl file under the platform directory", () => {
    const { kinds } = jumpcloudAtlasPaths({ atlasRoot: "/h/atlas" });

    expect(Object.keys(kinds).length).toBe(74);
    expect(kinds).toEqual(EXPECTED_KINDS);
  });
});
