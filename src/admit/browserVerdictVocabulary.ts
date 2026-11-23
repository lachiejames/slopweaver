/**
 * The verdict vocabulary the browser-door journal speaks, and the name of the retired tool family it refused.
 *
 * Held apart from `./browserSurface.ts` so the `PreToolUse` process, which reads only this, does not load the write
 * register: that register derives from every integration manifest, and this file imports nothing.
 */

/** The MCP name prefix every retired Claude-in-Chrome tool carries. */
export const CHROME_TOOL_PREFIX = "mcp__claude-in-chrome__";

/**
 * Every distinct exit the browser-door guard has ever journalled, as a stable code — the machine-readable
 * half of a verdict.
 *
 * Only `chrome-retired` is still WRITTEN: every Claude-in-Chrome call before
 * anything else is asked, and the page-by-page engine that produced the rest was deleted as unreachable
 * . The rest stay because `ledgers/browser-verdicts.jsonl` is
 * append-only history and `slopweaver browser verdicts` validates every code it reads back against this
 * list — dropping one would turn a real past row into an unreadable one.
 */
export const BROWSER_VERDICT_REASONS = [
  /** Legacy: the tool targeted no page at all, so there was nothing to judge. */
  "pageless-tool",
  /** Legacy: a `navigate` whose destination belonged to no registered platform. */
  "navigate-unregistered",
  /** Legacy: every item of a `browser_batch` was allowed on its own terms. */
  "batch-allowed",
  /** Legacy: the call named no tab, so it named no page. */
  "no-tab-named",
  /** Legacy: a read on a tab whose URL the session had never observed. */
  "unknown-tab-read",
  /** Legacy: a read on a host the write-policy register does not name. */
  "unregistered-read",
  /** Legacy: a read of a registered page a grant covered, or one on a platform with no door. */
  "granted-read",
  /** Legacy: a write on a `read-before-write` page that cleared all four conditions. */
  "read-before-write-satisfied",
  /** Legacy: the call arrived with arguments the guard could not read at all. */
  "unreadable-arguments",
  /** Legacy: a `browser_batch` whose `actions` was not a list. */
  "batch-unreadable-actions",
  /** Legacy: a `browser_batch` item that named no tool. */
  "batch-item-unnamed",
  /** Legacy: a `navigate` that spelled a doored provider's URL, with no grant covering it. */
  "doored-url",
  /** Legacy: a call on a tab known to be a doored provider's, with no grant covering the page. */
  "doored-no-grant",
  /** Legacy: a write-capable call on a reachable page whose platform is `refuse-every-write`. */
  "refuse-every-write",
  /** Legacy: a write-capable call on a tab whose URL the session had never observed. */
  "unknown-tab-write",
  /** Legacy: a write-capable call on a host the register does not name. */
  "unregistered-write",
  /** Legacy, read-before-write condition 1: the session carried no read ledger at all. */
  "read-before-write-no-ledger",
  /** Legacy, read-before-write condition 2: nothing had been read on that tab. */
  "read-before-write-no-read",
  /** Legacy, read-before-write condition 2: the last read was of a different page than the tab was on. */
  "read-before-write-other-page",
  /** Legacy, read-before-write condition 3: the last read was older than the two-minute window. */
  "read-before-write-stale-read",
  /** Legacy, read-before-write condition 4: the last write on that tab had not been read back. */
  "read-before-write-unread-write",
  /** The Claude-in-Chrome extension is retired, so the call is refused whatever it was going to do. */
  "chrome-retired",
] as const;

/**
 * Every distinct exit this guard has, derived from {@link BROWSER_VERDICT_REASONS} so the runtime list and
 * the type cannot drift — the journal has to validate a code it reads back, and a hand-written union would
 * have given it nothing to validate against.
 */
export type BrowserVerdictReason = (typeof BROWSER_VERDICT_REASONS)[number];

/**
 * What a verdict was ABOUT — enough for a later reader to know which page nearly got typed into.
 *
 * `tabId` and `url` are both optional because both genuinely can be absent: the retirement refusal names
 * only the tool, and a historical row about a tab the session had never observed has no URL to name. An
 * absent field is the honest answer rather than a placeholder, which is what stops a journal row asserting a
 * page nobody ever saw.
 *
 * @internal carried on a {@link BrowserDecision}; the journal reads it rather than building one.
 */
export interface BrowserVerdictSubject {
  /** The tool's BARE name, as the schemas spell it (`computer`, `navigate`). */
  readonly tool: string;
  readonly tabId?: number;
  readonly url?: string;
}

/**
 * The guard's verdict — a `block` ALWAYS carries the message, so there is no optional fallback text, and
 * BOTH arms carry the reason code and the subject so an allow is as journallable as a refusal.
 */
export type BrowserDecision =
  | {
      readonly block: true;
      readonly message: string;
      readonly reason: BrowserVerdictReason;
      readonly subject: BrowserVerdictSubject;
    }
  | { readonly block: false; readonly reason: BrowserVerdictReason; readonly subject: BrowserVerdictSubject };

/**
 * Strip the MCP prefix, so a refusal reads as the tool names the schemas use.
 *
 * @returns the tool's bare name
 * @internal — shared with `./chromeRetirement.ts`, which names the tool it refuses.
 */
export function bareToolName({ toolName }: { toolName: string }): string {
  return toolName.startsWith(CHROME_TOOL_PREFIX) ? toolName.slice(CHROME_TOOL_PREFIX.length) : toolName;
}
