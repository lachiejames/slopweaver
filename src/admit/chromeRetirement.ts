/**
 * The Claude-in-Chrome retirement — the one refusal that is not a policy a page could satisfy.
 *
 * Its own file rather than a function inside `./browserSurface.ts`, because it is a different KIND of thing
 * from everything in there. That module holds the write-policy register the Playwright verbs read; this one
 * decides that a whole transport is over, whatever page it is aimed at and whatever the caller holds.
 *
 * ## The ruling
 *
 * Claude in Chrome is off the table: the extension is deleted from the owner's browser, and all browser work
 * happens through Playwright, through the Playwright verbs built in Slopweaver.
 *
 * ## Why nothing waives it
 *
 * `./browserDoorGuardRunner.ts` asks this and nothing else: there is no page-by-page decision behind it, and
 * no environment variable or break-glass grant is consulted. The refusal says plainly that there is no
 * override rather than leaving a reader to discover it.
 *
 * The test is the PREFIX rather than a list of tool names, so a tool the extension ships tomorrow is refused
 * the day it appears rather than the day someone remembers to list it.
 */
import { type BrowserDecision, bareToolName, CHROME_TOOL_PREFIX } from "./browserVerdictVocabulary.js";

/**
 * The retirement refusal, rendered once.
 *
 * Claude in Chrome is off the table: the extension is deleted from the owner's browser, and all browser work
 * happens through Playwright, through the Playwright verbs built in Slopweaver.
 *
 * So this is not a policy that a page could satisfy, and it is deliberately NOT one of the register's two
 * write categories: there is no tab, read or write that makes a `mcp__claude-in-chrome__*` call admissible
 * any more, which is why the caller is handed a VERB rather than an override. `browser open` / `read` / `act` / `close` are the replacement, and they drive the same browser
 * through the Playwright extension relay — the one extension that stays.
 *
 * @param tool the tool's bare name, so the refusal says which call it refused
 * @returns the refusal lines
 */
function retirementRefusal({ tool }: { tool: string }): string {
  return (
    `browser-door: ${tool} is a Claude-in-Chrome call, and the Claude-in-Chrome extension is RETIRED — ` +
    "the owner's rule: every browser action goes through Slopweaver's own Playwright verbs. " +
    "Use `slopweaver browser open --url <url>` to take a session, `browser read` to see the page and get a " +
    "ref, `browser act --do <interaction>` to click, fill, select, upload or download with a screenshot of " +
    "its own result, and `browser close` when you are done. They drive the same Chrome through the " +
    "Playwright extension relay. There is no override: a waiver here would re-enable the lane the owner has " +
    "deleted, so neither a break-glass grant nor an exported variable lifts this one."
  );
}

/**
 * Whether a tool call is a retired Claude-in-Chrome call, and the refusal if it is.
 *
 * The whole of what the PreToolUse browser-door guard decides: the runner journals this verdict and exits 2.
 *
 * The test is the PREFIX, not a list of tool names, so a future tool the extension adds is refused the day
 * it appears rather than the day someone remembers to list it.
 *
 * @param toolName the tool's full MCP name, or its bare name
 * @returns the refusal, or `undefined` when this is not a Claude-in-Chrome call at all
 */
export function retiredChromeCall({
  toolName,
}: {
  toolName: string;
}): Extract<BrowserDecision, { block: true }> | undefined {
  if (!toolName.startsWith(CHROME_TOOL_PREFIX)) {
    return undefined;
  }
  const bare = bareToolName({ toolName });
  return {
    block: true,
    message: retirementRefusal({ tool: bare }),
    reason: "chrome-retired",
    subject: { tool: bare },
  };
}
