/*
 * The name maps every `flattenSlackVisibleProse` test file resolves mentions through, and the `flatten` wrapper for
 * a message with nothing already assembled. Pure data and one pure call, no disk.
 */
import { flattenSlackVisibleProse, type SlackNameMaps } from "../../../../../corpus/slack/visibleProse.js";

export const maps: SlackNameMaps = {
  channelNames: { C1: "releases" },
  userNames: { U1: "Ada", U2: "Grace" },
};

/**
 * Flatten with nothing already assembled — the common case for an app message with empty `text`.
 *
 * @returns the visible prose fragments, in the order the payload emits them
 */
export function flatten({ raw }: { raw: Record<string, unknown> }): readonly string[] {
  return flattenSlackVisibleProse({ dedupeAgainst: [], maps, raw });
}
