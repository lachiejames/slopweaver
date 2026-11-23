/**
 * The field-level boundary: exactly which Falcon fields this atlas stores, and which it refuses.
 *
 * ## An endpoint allowlist does not protect an atlas
 *
 * `inventory.ts` closes which calls may be made. It says nothing about what comes back, and Falcon's host
 * detail carries far more than the atlas needs. So admission is decided per FIELD here, and a field Falcon
 * adds next month is dropped at the boundary rather than stored because nobody thought to exclude it.
 *
 * ## Why the join keys are KEPT, against the instinct to strip them
 *
 * A first draft of this design denied `serial_number`, `hostname`, `mac_address` and the last-login account
 * as a privacy measure. That would have defeated the atlas: it is commissioned to trace failing devices to
 * people and to corroborate JumpCloud on which devices exist and who holds them, and serial, hostname and
 * MAC are precisely the three keys that join the two. It would have stored a machine id and a login COUNT,
 * and been unable to name one laptop or one person.
 *
 * Keeping them is also what this repository already does. `atlas/vanta/privacy.ts` deliberately admits
 * names, emails and policy text to the local generation and withholds only contract values; the hygiene
 * gate (`src/hygiene/scan.ts`) scans GIT-TRACKED files, and no atlas generation is one. The protection for
 * this data is that it never leaves the private state home — not that it was never collected.
 *
 * ## What is refused, and why the list is exact rather than a pattern
 *
 * Denials are exact, case-normalised key matches. A regex over "secret-looking" names is actively wrong
 * here: most secret-SHAPED field names on this platform are posture fields the ISO question needs —
 * `uninstall_protection`, `reduced_functionality_mode`, `rtr_state`, `safe_mode`, `sensor_file_status` —
 * and a sibling atlas measured a pattern bucketing legitimate policy fields as secrets. Every denial
 * below is named individually, so adding one is a decision somebody made rather than a regex tightening.
 *
 * The refusals are of two kinds. **Credentials** are refused because storing them would put a working
 * secret on disk. **Network locators** — IP addresses, gateway addresses — are refused because they change
 * constantly, identify a person's home network rather than their machine, and answer no question the atlas
 * was built for; the join runs on serial, hostname and MAC, which are stable properties of the hardware.
 */

/**
 * Field names never stored, whatever endpoint returns them, compared case-insensitively.
 *
 * Grouped by why, because the reason is what a future reader needs in order to judge an addition.
 */
export const CROWDSTRIKE_DENIED_FIELDS: readonly string[] = [
  // Credentials and session material. Storing any of these would put a usable secret in the generation.
  "access_token",
  "refresh_token",
  "client_secret",
  "authorization",
  "cookie",
  "set-cookie",
  "csrf_token",
  "uninstall_token",
  "maintenance_token",
  "provisioning_token",
  // Network locators. Volatile, describe a home or office network rather than the device, and the
  // cross-atlas join deliberately runs on hardware identity instead.
  "local_ip",
  "external_ip",
  "connection_ip",
  "default_gateway_ip",
  "connection_mac_address",
  // Command and file detail from detections. The atlas records THAT a detection exists and its posture
  // fields; a command line or a file path is incident content and belongs in the console, not on disk here.
  "cmdline",
  "command_line",
  "filepath",
  "filename",
  "parent_command_line",
];

/**
 * Whether a raw provider field name is refused.
 *
 * @param field the provider's own field name, as returned
 * @returns whether the projection must drop it
 */
export function isDeniedCrowdstrikeField({ field }: { field: string }): boolean {
  const normalised = field.trim().toLowerCase();
  return CROWDSTRIKE_DENIED_FIELDS.includes(normalised);
}

/**
 * The host fields this atlas stores, as Falcon names them.
 *
 * The first four are the cross-atlas join keys and the reason this list exists in the shape it does; the
 * rest are the posture and policy attachment the ISO question asks about.
 */
export const CROWDSTRIKE_HOST_FIELDS: readonly string[] = [
  "device_id",
  "serial_number",
  "hostname",
  "mac_address",
  "agent_version",
  "os_version",
  "os_build",
  "platform_name",
  "product_type_desc",
  "system_manufacturer",
  "system_product_name",
  "chassis_type_desc",
  "first_seen",
  "last_seen",
  "modified_timestamp",
  "status",
  "reduced_functionality_mode",
  "rtr_state",
  "device_policies",
  "groups",
  "kernel_version",
  "sensor_version",
];

/**
 * Whether the atlas's own reconciliation inputs all survive the projection.
 *
 * A guard against the exact regression this file's header describes: a later tightening that drops a join
 * key would leave the atlas unable to answer the question it exists for, and would do it silently, because
 * every other test would still pass. Asserted by a unit test rather than trusted.
 *
 * @returns the join keys that are required but not admitted; empty when the projection is sound
 */
export function missingJoinKeys(): readonly string[] {
  const required = ["serial_number", "hostname", "mac_address"];
  return required.filter((field) => !CROWDSTRIKE_HOST_FIELDS.includes(field) || isDeniedCrowdstrikeField({ field }));
}
