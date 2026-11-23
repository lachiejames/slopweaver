/**
 * The capability inventory for LIVE, judgement-based routing.
 *
 * This is deliberately NOT `buildSourcePlan` — that module keyword-matches a question against a capability
 * table and decides a route; this one never matches anything. It reuses `sourcePlan.ts`'s own overlay and
 * command-materialisation mechanics (the same private-profile merge and `{question}` substitution `route
 * plan` already proves), but the only decision it makes is "what can this context actually reach" — the
 * visible supervisor's own judgement decides relevance, never a term match.
 *
 * ## Why the partition is TOTAL, and why that is the fix rather than a detail
 *
 * Every eligible row lands in exactly one of three buckets and there is no fourth path for one to take. That
 * shape is load-bearing. This module used to select its output with `.filter(… && truthMode === "current")`,
 * so a row that matched no bucket was not reported anywhere — it was simply gone, with nothing failing and
 * nothing to read. MEASURED on one install: `turn brief --contracts` offered 44 available
 * and 4 unavailable rows and not one `truthMode: "history"` row, while the generic table and the private
 * overlay between them declared TWO reachable history legs (`corpus`, and the overlay's own
 * `claude-artifact-index`). Both were dropped silently. Reproduce the class on any install with
 * `slopweaver turn brief --contracts --text "what did we decide about X" | grep HISTORICAL`.
 *
 * The brief then told the judging session, in its own rendered contract, that a need may name a capability
 * "AVAILABLE or HISTORICAL" and that a historical leg can carry a `history` claim alone — promising a section
 * the roster it was printed beside did not contain. So the failure was never a refusal: a worker asked for
 * history read a roster of current legs, picked some, and wrote something fluent that read like a history.
 *
 * {@link partitionedCapabilities} is therefore a `switch` over `truthMode` with a `never`-typed default, not
 * a set of filters. Adding a third truth mode to `SourceCapability` stops COMPILING here instead of quietly
 * emptying a bucket, which is the only version of this guarantee that survives the next person.
 */

import { type AtlasRouteReading, deriveAtlasCapabilities } from "./atlasReading.js";
import { type CommandRouteReading, deriveCommandCapabilities } from "./commandReading.js";
import { type ConnectionRouteReading, deriveConnectionCapabilities } from "./connectionReading.js";
import { RESERVED_LIVE_NEED_IDS } from "./liveCapabilityPolicy.js";
import type { CapabilityProfile, SourceCapability } from "./profile.js";
import { GENERIC_SOURCE_CAPABILITIES, materialiseCapability, mergedCapabilities } from "./sourcePlan.js";
import { gradeHistoryRows, type StoreRouteReading } from "./storeReading.js";

/** The capability inventory a routing judgement is offered, partitioned by reachability and then truth mode. */
export interface RoutingCapabilities {
  /** Reachable and current-truth — the legs that can establish what is true NOW. */
  readonly available: readonly SourceCapability[];
  /**
   * Reachable and HISTORY — what was said, decided or recorded. Its own list rather than merged into
   * `available`, because the whole invariant (`../live/turn/judgement.ts`'s `DecisionTruthMode`) is that the
   * two are not interchangeable: a judgement may name one of these, and may not use one to satisfy a
   * present-state claim.
   */
  readonly historical: readonly SourceCapability[];
  /**
   * NOT reachable, whichever truth mode it declares — kept separate from both selectable lists so the host
   * can judge a surface unreachable (the old `ROUTE: unreachable` case) without that surface ever being
   * selectable as a live need. `turn answer` resolves an `unreachable` grounding's surface against this set,
   * and does so without reading `truthMode`, so an unreachable history leg belongs here rather than hidden.
   */
  readonly unavailable: readonly SourceCapability[];
}

/**
 * Assign every capability to exactly one bucket — the total partition the module header explains.
 *
 * @param capabilities the merged, atlas-graded, materialised rows, reserved ids already removed
 * @returns the three disjoint sets, each preserving the table's own declaration order
 */
function partitionedCapabilities({ capabilities }: { capabilities: readonly SourceCapability[] }): RoutingCapabilities {
  const available: SourceCapability[] = [];
  const historical: SourceCapability[] = [];
  const unavailable: SourceCapability[] = [];
  for (const capability of capabilities) {
    if (capability.availability.kind !== "available") {
      unavailable.push(capability);
      continue;
    }
    switch (capability.truthMode) {
      case "current": {
        available.push(capability);
        break;
      }
      case "history": {
        historical.push(capability);
        break;
      }
      default: {
        const unhandled: never = capability.truthMode;
        throw new Error(`routing inventory has no bucket for truthMode ${String(unhandled)}`);
      }
    }
  }
  return { available, historical, unavailable };
}

/**
 * Build the capability inventory for one turn's routing judgement.
 *
 * @param profile the validated private overlay, when one was explicitly supplied
 * @param question the question as asked — materialised into any `{question}` command token
 * @param slopweaverCommand the absolute bundled launcher this host resolved
 * @param baseCapabilities the generic table, replaceable only by compatibility tests
 * @param atlasReadings one grading per atlas platform — an atlas that cannot answer moves itself into
 *   `unavailable` here rather than being offered as a reachable current-truth source
 * @param commandReadings one grading per executable the table names — a row whose command cannot run on this
 *   host moves itself into `unavailable` rather than having its unrunnable argv printed into a brief
 * @param connectionReadings one grading per door holding a grant, so a door this install never connected is
 *   offered as unavailable carrying the connect verb rather than as a reachable current-truth leg
 * @param storeReading what the caller observed about the store the history leg reads; omitted means nobody
 *   looked, and the row is offered as declared rather than judged either way
 * @param home the home that observation was taken under, carried into every history row's own command so a
 *   brief taken under one home cannot print a command that opens another install's database
 * @returns the reachable current, reachable history and unreachable sets, reserved ids excluded from all
 *   three
 */
export function buildRoutingCapabilities({
  profile,
  question,
  slopweaverCommand,
  baseCapabilities = GENERIC_SOURCE_CAPABILITIES,
  atlasReadings = new Map<string, AtlasRouteReading>(),
  commandReadings = new Map<string, CommandRouteReading>(),
  connectionReadings = new Map<string, ConnectionRouteReading>(),
  storeReading,
  home,
}: {
  profile?: CapabilityProfile | undefined;
  question: string;
  slopweaverCommand: string;
  baseCapabilities?: readonly SourceCapability[] | undefined;
  atlasReadings?: ReadonlyMap<string, AtlasRouteReading> | undefined;
  commandReadings?: ReadonlyMap<string, CommandRouteReading> | undefined;
  connectionReadings?: ReadonlyMap<string, ConnectionRouteReading> | undefined;
  storeReading?: StoreRouteReading | undefined;
  home?: string | undefined;
}): RoutingCapabilities {
  const merged = mergedCapabilities({ baseCapabilities, profile });
  // Can it RUN comes before what it would hold: a row naming an executable this host does not have is refused
  // whatever its atlas published, and clearing its command is what stops the argv reaching a worker's brief.
  const runnable = deriveCommandCapabilities({ capabilities: merged.capabilities, readings: commandReadings });
  // A door with no grant is refused BEFORE the atlas grading and the partition, on the same principle the
  // command grading is: an unreachable row must reach the partition already unavailable, so the one rule
  // that files it there has no second opinion to disagree with.
  const connected = deriveConnectionCapabilities({ capabilities: runnable, readings: connectionReadings });
  const capabilities = deriveAtlasCapabilities({ capabilities: connected, readings: atlasReadings })
    .filter((capability) => !RESERVED_LIVE_NEED_IDS.has(capability.id))
    .map((capability) => materialiseCapability({ capability, question, slopweaverCommand }));
  // Graded BEFORE the partition, and the order is the design. The partition files any row whose availability
  // is not `available` into `unavailable` whatever its truth mode, so a store the probe could not reach turns
  // its row unavailable here and the partition's own rule files it correctly, with no second place to decide.
  return partitionedCapabilities({ capabilities: gradeHistoryRows({ capabilities, home, reading: storeReading }) });
}
