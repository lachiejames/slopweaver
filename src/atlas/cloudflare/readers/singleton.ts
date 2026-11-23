/**
 * The one shape every Zero Trust SINGLETON reader folds its result through.
 *
 * Two things it settles, and the second is a finding rather than a convenience.
 *
 * **A missing singleton is zero entities, never an invented record.** An account that has never configured
 * Gateway logging, SSH session recording or a device profile gets `result: null` from Cloudflare, and the
 * honest atlas answer is an empty array plus a successful coverage cell — "we read it, there is nothing
 * there". Projecting an all-null entity instead would put a record on disk that the provider does not have.
 *
 * **The SDK's types say that cannot happen, and the wire says it can.** `gateway.configurations.get`,
 * `gateway.logging.get`, `gateway.auditSSHSettings.get`, `devices.settings.get`,
 * `connectivitySettings.get` and `organizations.list` are all typed non-nullable in `cloudflare@7.1.0`,
 * so an inline `value == null` check against one is dead code to the type checker and `oxlint`'s
 * `no-unnecessary-condition` refuses it — correctly, on the types it was given. Taking a deliberately
 * NULLABLE parameter here is what makes the runtime guard expressible without a type assertion: the check
 * inside is against a genuinely nullable value, and a non-nullable argument is assignable to it. The guard
 * is not theoretical — `readers/zeroTrust.test.ts`'s "returns NO entity for a null singleton" passes a
 * `result: null` body through the real client and gets `[]` back.
 */
import type { CloudflareEntity } from "../model.js";

/**
 * One entity when the singleton is present, none when the provider says there is nothing configured.
 *
 * @param value the singleton the SDK returned — typed nullable on purpose; see this file's header
 * @param project builds the entity from a present singleton
 * @returns a one-element array, or an empty one
 */
export function singletonEntities<T>({
  value,
  project,
}: {
  value: T | null | undefined;
  project: (args: { value: T }) => CloudflareEntity;
}): readonly CloudflareEntity[] {
  return value == null ? [] : [project({ value })];
}
