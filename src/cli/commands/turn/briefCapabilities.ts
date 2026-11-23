/**
 * What `turn brief` can actually reach, graded before anything plans with it.
 *
 * Its own module beside `./brief.ts` rather than inside it, along the seam that was already there: both
 * doors into that file — the read-only `--contracts` print and the brief compose — want exactly this one
 * answer and nothing else in the file does. Keeping it here is also what keeps the two from drifting on
 * WHETHER they grade, which is the property the grading rule actually asks for.
 *
 * Three gradings run before the partition, and each closes a measured way a row lied about itself:
 *
 * - **The atlases** (`../../../route/atlasReading.ts`) — a generation that cannot answer stops advertising
 *   itself as reachable current truth. Owner ruling: no row is `available` by declaration alone.
 * - **The commands** (`../../../route/commandReading.ts`) — a row naming an executable this host cannot run
 *   is refused and its argv cleared, so an unrunnable command never reaches a worker's brief.
 * - **The doors** (`../../../route/connectionReading.ts`) — a Gmail, Drive or Calendar row this install never
 *   connected is refused with the connect verb named, rather than offered as reachable.
 * - **The history leg** (`../../../store/reading.ts`) — the `corpus` row used to declare itself available
 *   as a literal while the command it named refused in every bot turn. `observeStore` is one connection with
 *   a hard budget, so a stopped Docker costs a turn a fraction of a second and produces an UNAVAILABLE row
 *   carrying the reason, never a confident row over nothing.
 */
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { bundledLauncherPath, installedTreeRoot } from "../../../lib/pluginRoot.js";
import { withDerivedAtlasCapabilities } from "../../../route/atlasCapability.js";
import type { AtlasRouteReading } from "../../../route/atlasReading.js";
import { atlasRouteReadings } from "../../../route/atlasReadings.js";
import { registeredAtlasSources } from "../../../route/atlasSources.js";
import type { CommandRouteReading } from "../../../route/commandReading.js";
import { commandRouteReadings } from "../../../route/commandReadings.js";
import type { ConnectionRouteReading } from "../../../route/connectionReading.js";
import { connectionRouteReadings } from "../../../route/connectionReadings.js";
import type { SourceCapability } from "../../../route/profile.js";
import type { loadCapabilityProfile } from "../../../route/profileStore.js";
import { buildRoutingCapabilities } from "../../../route/routingCapabilities.js";
import { GENERIC_SOURCE_CAPABILITIES, mergedCapabilities } from "../../../route/sourcePlan.js";
import type { StoreRouteReading } from "../../../route/storeReading.js";
import { observeStore } from "../../../store/reading.js";

/** Everything the four gradings observed about this host, ready for {@link buildRoutingCapabilities}. */
interface RoutingCapabilityObservations {
  readonly atlasReadings: ReadonlyMap<string, AtlasRouteReading>;
  readonly commandReadings: ReadonlyMap<string, CommandRouteReading>;
  readonly connectionReadings: ReadonlyMap<string, ConnectionRouteReading>;
  /** The bundled launcher every `slopweaver` argv is materialised against. */
  readonly slopweaverCommand: string;
  readonly storeReading: StoreRouteReading;
}

/**
 * Observe what this host can reach for one merged capability table — every atlas, executable, door and
 * store read the routing inventory is graded against. The seam a test replaces so none of them runs.
 */
export type RoutingCapabilitiesObserver = (input: {
  capabilities: readonly SourceCapability[];
  home: string;
}) => Promise<RoutingCapabilityObservations>;

/**
 * The production {@link RoutingCapabilitiesObserver}: the launcher path, then the atlas and store reads in
 * parallel, then the executable lookups, then the door grants — the order the inventory always read them in.
 *
 * @param capabilities the merged table every reading grades
 * @param home the state home the atlases, grants and store live under
 * @returns what each grading observed
 */
async function observeRoutingCapabilities({
  capabilities,
  home,
}: {
  capabilities: readonly SourceCapability[];
  home: string;
}): Promise<RoutingCapabilityObservations> {
  const slopweaverCommand = bundledLauncherPath({ importMetaUrl: import.meta.url });
  const [atlasReadings, storeReading] = await Promise.all([
    atlasRouteReadings({ capabilities, home }),
    observeStore({ home }),
  ]);
  const commandReadings = commandRouteReadings({
    capabilities,
    slopweaverCommand,
    treeRoot: installedTreeRoot({ importMetaUrl: import.meta.url }),
  });
  const connectionReadings = await connectionRouteReadings({ capabilities, home, profiles: recordedProfilePort() });
  return { atlasReadings, commandReadings, connectionReadings, slopweaverCommand, storeReading };
}

/**
 * Build the routing inventory for one question, graded against what this host can really reach.
 *
 * @param capabilityOutcome what `loadCapabilityProfile` said about this installation's overlay
 * @param home the resolved state home the atlases and the store live under
 * @param question the question as asked, materialised into any `{question}` command token
 * @param observe what reads this host's atlases, executables, doors and store; the real reads unless a test
 *   supplies a fake
 * @returns the reachable, unreachable and historical capability sets
 */
export async function routingCapabilitiesFor({
  capabilityOutcome,
  home,
  question,
  observe = observeRoutingCapabilities,
}: {
  capabilityOutcome: ReturnType<typeof loadCapabilityProfile>;
  home: string;
  question: string;
  observe?: RoutingCapabilitiesObserver;
}): Promise<ReturnType<typeof buildRoutingCapabilities>> {
  const overlay = capabilityOutcome.kind === "profile" ? { profile: capabilityOutcome.profile } : {};
  const profile = capabilityOutcome.kind === "profile" ? capabilityOutcome.profile : undefined;
  // Every REGISTERED atlas gets a row here, so a platform landed today is routable today rather than when
  // somebody remembers to hand-author one into this install's overlay. Computed ONCE and handed to both the
  // merge below and `buildRoutingCapabilities` — deriving it twice is a second place the two could disagree
  // about which table was graded. `../../../route/atlasCapability.ts` carries the measurement.
  const baseCapabilities = withDerivedAtlasCapabilities({
    atlases: registeredAtlasSources(),
    baseCapabilities: GENERIC_SOURCE_CAPABILITIES,
    overlay: profile === undefined ? [] : profile.capabilities,
  });
  // Merged ONCE, and handed to both gradings: two merges of the same inputs are a second place the two
  // readings could disagree about which table they graded.
  const merged = mergedCapabilities({ baseCapabilities, profile });
  const observed = await observe({ capabilities: merged.capabilities, home });
  return buildRoutingCapabilities({
    atlasReadings: observed.atlasReadings,
    baseCapabilities,
    commandReadings: observed.commandReadings,
    connectionReadings: observed.connectionReadings,
    home,
    question,
    slopweaverCommand: observed.slopweaverCommand,
    storeReading: observed.storeReading,
    ...overlay,
  });
}
