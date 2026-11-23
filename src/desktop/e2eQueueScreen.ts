/**
 * The `queue-screen-reading` step of `slopweaver desktop e2e`, its pure half: what the voice's window is handed when
 * it asks for the Queue on screen must be the Queue the console tab draws — the keys its rows carry, in the order it
 * draws them, each resolvable among the cards handed over. The effectful half is
 * `src/cli/commands/desktop/e2eQueueScreen.ts`.
 *
 * The reason: the voice's window once answered from its own held copy and listed cards the console window's Queue
 * had stopped drawing hours before. The voice now answers from the record, read fresh, and checks it against this snapshot, so the snapshot must be the screen exactly. The step asks through the
 * real bridge the voice's Queue tools ask through (`requestVoiceQueue`), so main, the active tab's preload and its
 * provider are all on the path; no call is placed, so no model decides it.
 */

/** What one Queue snapshot showed of itself, as far as the step judges it. */
export interface QueueScreenSeen {
  /** The keys the console tab's Queue rows carry, top to bottom (`data-card-key`). */
  readonly drawnKeys: readonly string[];
  /** What the voice's window was handed for its ask, exactly as the bridge resolved. */
  readonly answer: unknown;
}

/**
 * A plain object, or `undefined`.
 *
 * @param value anything
 * @returns it as a record when it is a non-array object
 */
function recordOf({ value }: { value: unknown }): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * The served snapshot inside the bridge's answer.
 *
 * @param answer what the bridge resolved
 * @returns the parsed snapshot, or why there is none
 */
function snapshotOf({ answer }: { answer: unknown }): Record<string, unknown> | string {
  const outer = recordOf({ value: answer });
  if (outer === undefined) {
    return `the bridge answered ${JSON.stringify(answer)}, not an answer`;
  }
  if (outer["kind"] === "unreached") {
    return `the console tab's Queue did not reach the voice's window: ${String(outer["why"])}`;
  }
  const wire = outer["snapshot"];
  if (outer["kind"] !== "served" || typeof wire !== "string") {
    return "the bridge's answer was neither served nor unreached";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(wire);
  } catch {
    return "the served snapshot is not JSON";
  }
  const snapshot = recordOf({ value: parsed });
  if (snapshot === undefined) {
    return "the served snapshot is not an object";
  }
  return snapshot;
}

/**
 * Two key lists the same, key for key in order. Element-wise, because a joined string collides when a key carries the
 * separator.
 *
 * @param left one list
 * @param right the other
 * @returns whether they hold the same keys in the same order
 */
export function sameKeys({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/**
 * The drawn cards the card tools could not resolve. They resolve a key against the tab's rows, which hold more than
 * one view draws, so every drawn card must resolve there; the rows need not equal the drawn order.
 *
 * @param cards the snapshot's `cards`
 * @param drawnKeys the keys the Queue tab draws
 * @returns the drawn keys no row carries
 */
function unresolvedDrawn({ cards, drawnKeys }: { cards: unknown; drawnKeys: readonly string[] }): readonly string[] {
  const rows = recordOf({ value: cards })?.["rows"];
  const rowKeys = new Set((Array.isArray(rows) ? rows : []).map((row: unknown) => recordOf({ value: row })?.["key"]));
  return drawnKeys.filter((key) => !rowKeys.has(key));
}

/**
 * Every way the snapshot fails to be the Queue the console tab draws: taken off the Queue, carrying other keys or
 * another order than the tab's rows, or a drawn card the card tools could not resolve.
 *
 * @param seen the drawn keys and the bridge's answer
 * @returns the breaks; empty when the voice was handed the Queue on screen
 */
export function queueScreenBreaks({ seen }: { seen: QueueScreenSeen }): readonly string[] {
  const snapshot = snapshotOf({ answer: seen.answer });
  if (typeof snapshot === "string") {
    return [snapshot];
  }
  const breaks: string[] = [];
  const path = snapshot["path"];
  if (typeof path !== "string" || !/^\/queue(?:[?#]|$)/u.test(path)) {
    breaks.push(`the snapshot was taken on ${JSON.stringify(path)}, not the Queue`);
  }
  const keys = snapshot["drawnKeys"];
  if (!Array.isArray(keys) || !keys.every((key: unknown): key is string => typeof key === "string")) {
    breaks.push("the snapshot carries no list of the keys the Queue drew");
    return breaks;
  }
  if (!sameKeys({ left: keys, right: seen.drawnKeys })) {
    breaks.push(
      `the snapshot says the Queue drew [${keys.join(", ")}] where its rows carry [${seen.drawnKeys.join(", ")}]`,
    );
  }
  const unresolved = unresolvedDrawn({ cards: snapshot["cards"], drawnKeys: seen.drawnKeys });
  if (unresolved.length > 0) {
    breaks.push(`the card tools could not resolve the drawn card(s) [${unresolved.join(", ")}] in the snapshot's rows`);
  }
  return breaks;
}
