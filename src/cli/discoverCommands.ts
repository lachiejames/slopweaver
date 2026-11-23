/**
 * Registry auto-discovery — the single source a `catalog` verb and a help renderer both derive from.
 *
 * Walks the `NOUN_GROUPS` registry into one flat list of `{ noun, verb, meta }`. Deriving from
 * `NOUN_GROUPS` — rather than a second hand-maintained list — means a verb cannot be described without
 * being wired, and cannot be wired without appearing in the catalog.
 *
 * Pure: no I/O. Caller passes the registry (`NOUN_GROUPS`) so this stays trivially testable.
 */
import type { CommandMeta } from "./defineCommand.js";
import { DEFAULT_VERB } from "./manifest.js";
import type { NounGroups } from "./router.js";

export interface DiscoveredCommand {
  readonly noun: string;
  readonly verb: string;
  /** The verb's metadata, read off the registry entry without importing the command module. */
  readonly meta: CommandMeta;
}

/**
 * Enumerate every registered noun/verb in the registry with its metadata. Sorted by noun then verb for
 * stable catalog/help output.
 *
 * @param groups the noun registry
 * @returns the flat, sorted list of discovered commands
 */
export function discoverCommands({ groups }: { groups: NounGroups }): readonly DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];
  for (const noun of Object.keys(groups)) {
    const verbs = groups[noun] ?? {};
    for (const verb of Object.keys(verbs)) {
      const entry = verbs[verb];
      // The DEFAULT_VERB key is an alias for a real named verb (e.g. doctor default -> run); skip it so
      // the catalog enumerates each command once, not a phantom blank-verb entry.
      if (entry === undefined || verb === DEFAULT_VERB) {
        continue;
      }
      // A registry entry exposes its meta WITHOUT importing the command module — enumeration of a noun
      // pays zero import cost. Every entry carries one: `NounManifestModule.verbs` admits no other shape,
      // so there is no undescribed verb for the catalog to report as a gap.
      commands.push({ meta: entry.meta, noun, verb });
    }
  }
  return commands.toSorted((a, b) => (a.noun === b.noun ? a.verb.localeCompare(b.verb) : a.noun.localeCompare(b.noun)));
}
