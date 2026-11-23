/**
 * Which addresses a local-stack container's published port reaches, read off what docker reports — the one
 * loopback policy every store reader shares, so the Storage API and the database never disagree on what
 * "local only" means.
 *
 * A publication on `0.0.0.0`, `::` or a LAN address means another machine can reach the port. Docker
 * Desktop's default port binding publishes on every interface; its "Localhost only" setting publishes on
 * `127.0.0.1` and `::1`. MEASURED on this Mac with "Localhost only": `docker port supabase_db_<project> 5432/tcp`
 * prints `127.0.0.1:55322` and `[::1]:55322`.
 */

/** One host address and port docker publishes a container port on. */
export interface PublishedPort {
  /** The host address, IPv6 without its brackets; empty means every interface. */
  readonly hostIp: string;
  readonly port: number;
}

/** What kind of exposure a non-loopback publication is — never the address itself. */
export type DockerExposureLabel = "every interface" | "a non-loopback address";

/**
 * Whether an address docker publishes on reaches this machine only.
 *
 * @param hostIp the `HostIp` docker reports; an empty one means every interface
 * @returns true for an IPv4 loopback address or `::1`
 */
export function isLoopbackHostIp({ hostIp }: { hostIp: string }): boolean {
  return hostIp === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(hostIp);
}

/**
 * What kind of exposure a non-loopback publication is — never the address itself, which is docker metadata
 * a refusal has no need to carry.
 *
 * @param hostIp the `HostIp` docker reports; empty, `0.0.0.0` and `::` all mean every interface
 * @returns `every interface` or `a non-loopback address`
 */
export function exposureLabel({ hostIp }: { hostIp: string }): DockerExposureLabel {
  if (hostIp === "" || hostIp === "0.0.0.0" || hostIp === "::") {
    return "every interface";
  }
  return "a non-loopback address";
}

/**
 * The exposures among a container's publications, one label each, deduplicated in first-seen order.
 *
 * @param ports every publication docker reported
 * @returns the labels of the non-loopback ones — empty when every publication is loopback
 */
export function exposuresOf({ ports }: { ports: readonly PublishedPort[] }): readonly DockerExposureLabel[] {
  const labels = ports
    .filter((port) => !isLoopbackHostIp({ hostIp: port.hostIp }))
    .map((port) => exposureLabel({ hostIp: port.hostIp }));
  return [...new Set(labels)];
}
