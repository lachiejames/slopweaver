/**
 * A capability row whose door was never connected is refused, instead of being printed as a way to reach a
 * source that will ask for consent the moment a worker runs it.
 *
 * ## Why this is a third grading rather than a field on the row
 *
 * `./commandReading.ts` answers "can this argv run on this host" and `./atlasReading.ts` answers "does this
 * generation hold anything". Neither can see a Google door: `slopweaver gmail list` resolves perfectly on a
 * host that has never run `gmail connect`, and there is no atlas generation behind it. The door's real
 * reachability lives in one file under `$SLOPWEAVER_HOME/secrets`, which is state outside the repository —
 * so it is a READING, taken by `./connectionReadings.ts`, and this module is the pure rule applied to it.
 *
 * ## Why an absent reading leaves the row exactly as declared
 *
 * The same contract the other two gradings hold to: nobody looked is not the same fact as looked and found
 * nothing. A caller that grades no doors plans from the table as written, which is what every pure test and
 * every projection does; the two CLI hosts (`src/cli/commands/route/run.ts`,
 * `src/cli/commands/turn/briefCapabilities.ts`) always grade.
 *
 * The browser door holds no grant, because it drives the owner's own signed-in Chrome rather than a credential
 * of its own — but it is graded all the same, on the one thing that is a property of the ROW rather than of a
 * page: whether this machine has recorded WHICH of the owner's Chrome profiles every browser leg reads. With none
 * recorded the lane refuses to guess, so the row could reach nothing at all and has to say so. Whether a given
 * origin has a live session stays per-page, and its own verb answers it (`browser cookies --origin <url>`).
 */
import type { SourceCapability } from "./profile.js";

/** The generic door rows this grading covers, mapped to the verb that opens each. */
const CONNECT_VERB_BY_DOOR: Readonly<Record<string, string>> = {
  browser: "slopweaver browser profile --list, then --set <directory>",
  calendar: "slopweaver calendar connect",
  drive: "slopweaver drive connect",
  gmail: "slopweaver gmail connect",
  outlook: "slopweaver outlook connect",
};

/** Whether the door one capability row reaches through has a usable grant on this install. */
export type ConnectionRouteReading =
  | { readonly door: string; readonly connected: true; readonly account: string }
  | { readonly door: string; readonly connected: false; readonly why: string };

/**
 * The door a capability row reaches through, when it is one this grading knows how to judge.
 *
 * Matched on the row's stable id rather than on its argv, so an installation that overlays its own command
 * onto the `gmail` row is still graded on whether the mailbox is connected.
 *
 * @param capability the row to inspect
 * @returns the door name, or `null` for every row that holds no grant
 */
export function connectionDoorOf({ capability }: { capability: SourceCapability }): string | null {
  return capability.id in CONNECT_VERB_BY_DOOR ? capability.id : null;
}

/**
 * Rewrite one capability row from what the grant store said about its door.
 *
 * An unconnected door becomes `unavailable` with its command CLEARED — `sourceCapabilitySchema` refuses an
 * unavailable row that still declares a runnable argv, and the cleared argv is exactly what stops a worker
 * being handed a command whose first act would be to open a consent page.
 *
 * @param capability the row as declared
 * @param reading what the grant store established, or `undefined` when nobody looked
 * @returns the row to plan with
 */
export function deriveConnectionCapability({
  capability,
  reading,
}: {
  capability: SourceCapability;
  reading: ConnectionRouteReading | undefined;
}): SourceCapability {
  if (reading === undefined || reading.connected || capability.availability.kind === "unavailable") {
    return capability;
  }
  const connectVerb = CONNECT_VERB_BY_DOOR[reading.door];
  const fix = connectVerb === undefined ? "" : ` — run \`${connectVerb}\``;
  return {
    ...capability,
    availability: { kind: "unavailable", reason: `${reading.why}${fix}` },
    command: [],
    coverage: { detail: reading.why, kind: "unknown" },
  };
}

/**
 * Apply {@link deriveConnectionCapability} to every row whose door this grading covers.
 *
 * @param capabilities the merged capability table
 * @param readings one grading per door, keyed by {@link connectionDoorOf}'s output
 * @returns the table with every unconnected door refused, and every other row untouched
 */
export function deriveConnectionCapabilities({
  capabilities,
  readings,
}: {
  capabilities: readonly SourceCapability[];
  readings: ReadonlyMap<string, ConnectionRouteReading>;
}): readonly SourceCapability[] {
  return capabilities.map((capability) => {
    const door = connectionDoorOf({ capability });
    return deriveConnectionCapability({ capability, reading: door === null ? undefined : readings.get(door) });
  });
}
