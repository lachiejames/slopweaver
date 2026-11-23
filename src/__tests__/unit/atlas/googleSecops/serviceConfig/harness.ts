/**
 * The one fixture the serviceConfig test files share: inline `chronicle_v1.yaml` text in the real file's shape,
 * which each case edits in place. Pure text; nothing here touches a disk.
 */

/** A minimal service config: two published services, two HTTP bindings and one authentication rule. */
export const CONFIG = `type: google.api.Service
config_version: 3
name: chronicle.googleapis.com

apis:
- name: google.cloud.chronicle.v1.RuleService
- name: google.longrunning.Operations

http:
  rules:
  - selector: google.longrunning.Operations.GetOperation
    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'
  - selector: google.longrunning.Operations.CancelOperation
    post: '/v1/{name=projects/*/locations/*/instances/*/operations/*}:cancel'
    body: '*'

authentication:
  rules:
  - selector: 'google.cloud.chronicle.v1.RuleService.*'
    oauth:
      canonical_scopes: |-
        https://www.googleapis.com/auth/chronicle,
        https://www.googleapis.com/auth/cloud-platform

publishing:
  api_short_name: chronicle
`;
