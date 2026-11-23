/**
 * What a Slack reference renders as when the corpus cannot name it from an id: the generic `@user`, `#channel`
 * and `@group` labels, and the `<!…>` special references. Every function here is pure.
 *
 * Split from `./visibleProse.ts` along the line between FINDING a reference in markup and choosing the words it
 * renders as. The rule they all serve is `resolveSlackMarkup`'s: an opaque `Uxxxx`/`Cxxxx`/`Sxxxx` id is NEVER left
 * in stored text.
 */

/**
 * The name a `<@U…>` mention renders as. A user neither the corpus's name map nor Slack's pipe label names is
 * shown as the generic `user`, because the only other thing to hand is the raw id the render rule forbids.
 *
 * @param name the user's name from the corpus's map, else the pipe label Slack sent, when either exists
 * @returns the name to put after the `@`
 */
export function userMentionText({ name }: { name: string | undefined }): string {
  if (name === undefined) {
    return "user";
  }
  return name;
}

/**
 * The name a `<#C…>` mention renders as. A channel neither the corpus's name map nor Slack's pipe label names
 * is shown as the generic `channel`, because the only other thing to hand is the raw id the render rule
 * forbids.
 *
 * @param name the channel's name from the corpus's map, else the pipe label Slack sent, when either exists
 * @returns the name to put after the `#`
 */
export function channelMentionText({ name }: { name: string | undefined }): string {
  if (name === undefined) {
    return "channel";
  }
  return name;
}

/**
 * A `<!…>` special reference. Two shapes reach here and they resolve differently:
 *
 * - a **usergroup**, which Slack sends either labelled (`<!subteam^S…|@handle>`) or **bare**
 *   (`<!subteam^S…>`). A bare one carries nothing but the group's own id, so it is looked up in
 *   `SlackNameMaps.usergroupHandles` (`./visibleProse.ts`) — the corpus's own map — and falls back to the
 *   stable generic `@group` when that map has never seen it. Rendering `ref.slice(1)` would put `subteam^S…`
 *   in stored text, which is the one opaque-id case `resolveSlackMarkup`'s contract used to miss.
 *
 *   MEASURED: 48 distinct usergroups sat in this workspace's structure bronze and 0 of them were
 *   resolvable, because there was no third map to look one up in. Nothing was missing from the store;
 *   nothing READ it. The fallback is deliberately unchanged — a miss must stay a visible non-answer rather
 *   than become a plausible wrong handle.
 * - anything else (`<!here>`, `<!channel>`, `<!date^…|<formatted date>>`), which keeps its existing rendering.
 *
 * A label Slack sent for a usergroup already carries its own `@`, so it is used as-is rather than prefixed —
 * a second `@` is not part of the label.
 *
 * @param ref the reference body, `!`-prefixed
 * @param label the pipe label Slack sent, when it sent one
 * @param usergroupHandles usergroup id (`S…`) → its `@`-less handle, when the corpus holds that map
 * @returns the human-readable rendering of the reference
 */
export function resolveSpecialRef({
  ref,
  label,
  usergroupHandles,
}: {
  ref: string;
  label: string | undefined;
  usergroupHandles: Readonly<Record<string, string>> | undefined;
}): string {
  if (label !== undefined) {
    return label.startsWith("@") ? label : `@${label}`;
  }
  const kind = ref.slice(1);
  if (!kind.startsWith("subteam^")) {
    return `@${kind}`;
  }
  const handle = usergroupHandles?.[kind.slice("subteam^".length)];
  return handle === undefined ? "@group" : `@${handle}`;
}
