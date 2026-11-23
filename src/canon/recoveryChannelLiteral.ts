/**
 * The criterion for a hand-carried recovery channel list — canon that spells real Slack conversation ids
 * where it should be spelling a way to DERIVE them.
 *
 * ## What it holds down
 *
 * The live loop's widened gap pass was carried forward from shift to shift as a literal of thirteen
 * conversation ids for over three weeks. When the bot was tagged in `C0SYN000011` (`#acme-bugs`) —
 * a private channel it IS a member of, and one that literal had never named — every widened pass
 * was structurally blind to it. Nothing failed, because a pass that never opens a channel reports
 * exactly what a quiet channel reports.
 *
 * A membership list is timestamped evidence about the instant it was read, never a recipe. `listen recover
 * --discover-channels` asks the bot token itself, so a channel the bot was invited to yesterday is in scope
 * today. That is the shape canon has to advertise, and this criterion is what stops the literal coming back
 * the next time somebody copies a command forward.
 *
 * ## The criterion, stated rather than counted
 *
 * A `listen recover` invocation whose `--channels` value names **two or more REAL conversation ids**. One id
 * is a legitimate worked example of reply eligibility — `--channels` is required in every mode and a reader
 * needs to see what one looks like; two or more is somebody's workspace inventory. A placeholder (`C_ONE`,
 * `<the channels it answers in>`) names nothing real and is outside the criterion by construction, because
 * {@link REAL_CONVERSATION_ID} matches only Slack's own `C`/`D`/`G` + uppercase-alphanumeric shape and an
 * underscore ends the match.
 *
 * ```text
 * listen recover --bot-user U0BOT --channels C0SYN000002,C0SYN000011 --since 3d   # REFUSED — an inventory
 * listen recover --bot-user U0BOT --channels <where it may reply> --discover-channels --since 3d   # the shape
 * ```
 *
 * Its blind spot, stated rather than discovered: a list broken across prose ("the thirteen are C…, C…, and
 * C…") is not a `--channels` value and is invisible here. The shape this gate holds down is the one that
 * gets COPIED — a runnable command line.
 */

/**
 * Slack's own conversation-id shape: a `C`/`D`/`G` followed by at least eight more uppercase alphanumerics.
 * An underscore stops the match, which is what keeps `C_ONE` and `CLAUDE_PLUGIN_ROOT` outside it.
 */
const REAL_CONVERSATION_ID = /\b[CDG][A-Z0-9]{8,}\b/g;

/** How many real ids in one `--channels` value stop being a worked example and become an inventory. */
const INVENTORY_AT = 2;

/** One canon line advertising a hand-carried channel list. */
export interface RecoveryChannelLiteral {
  readonly path: string;
  /** The 1-indexed physical line the logical line STARTS on. */
  readonly line: number;
  /** The real conversation ids the `--channels` value named, in the order they appeared. */
  readonly channels: readonly string[];
}

/**
 * The real conversation ids one `--channels` value names.
 *
 * @param value the raw flag value, exactly as written on the line
 * @returns every id matching Slack's own shape, in order
 */
export function realChannelIds({ value }: { value: string }): readonly string[] {
  return [...value.matchAll(REAL_CONVERSATION_ID)].map((match) => match[0]);
}

/**
 * The ids one logical line hard-codes, when that line is a `listen recover` carrying an inventory.
 *
 * @param text the logical line, backslash continuations already folded in
 * @returns the hard-coded ids, or `undefined` when the line is not an offender
 */
export function recoveryChannelLiteralOf({ text }: { text: string }): readonly string[] | undefined {
  if (!text.includes("listen recover")) {
    return undefined;
  }
  const flag = /--channels[= ]+(\S+)/.exec(text);
  const value = flag?.[1];
  if (value === undefined) {
    return undefined;
  }
  const ids = realChannelIds({ value });
  if (ids.length < INVENTORY_AT) {
    return undefined;
  }
  return ids;
}

/**
 * Every offending line in one file, in the shape `scanTextFiles` consumes.
 *
 * @param logicalLines the file's logical lines, from `logicalLines({ content })`
 * @param path the repo-relative path, carried onto each hit for the report
 * @returns one entry per line hard-coding a channel inventory
 */
export function recoveryChannelLiterals({
  logicalLines,
  path,
}: {
  logicalLines: readonly { readonly line: number; readonly text: string }[];
  path: string;
}): readonly RecoveryChannelLiteral[] {
  const found: RecoveryChannelLiteral[] = [];
  for (const { line, text } of logicalLines) {
    const channels = recoveryChannelLiteralOf({ text });
    if (channels !== undefined) {
      found.push({ channels, line, path });
    }
  }
  return found;
}

/**
 * Print one offender the way a reader can act on: the site, the ids, and what to write instead.
 *
 * @param literal the offending line
 * @returns a single display line
 */
export function formatRecoveryChannelLiteral({ literal }: { literal: RecoveryChannelLiteral }): string {
  return (
    `${literal.path}:${literal.line}  hard-codes ${literal.channels.length} channel ids ` +
    `(${literal.channels.join(", ")}) — widen with --discover-channels instead`
  );
}
