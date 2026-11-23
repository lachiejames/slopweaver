/**
 * The one way a "Nothing stale" line names an address. Every surface's stored document carries addresses the
 * section did not mint — a permalink, a pull request's URL — and the briefing schema refuses a link that is not
 * one, so an address that will not parse is shown as text instead of refusing the whole section.
 *
 * Pure.
 */
import type { BriefingContent } from "../outbound/briefing/types.js";

/**
 * A link run when the address parses as one, else the text with the address beside it in code — so one odd
 * address reads as text rather than refusing the whole section.
 *
 * @param text what the link reads as
 * @param url where it points
 * @returns one or two runs
 */
export function linkRuns({ text, url }: { readonly text: string; readonly url: string }): BriefingContent {
  if (URL.canParse(url)) {
    return [{ kind: "link", text, url }];
  }
  return [
    { kind: "text", text: `${text} ` },
    { kind: "code", text: url },
  ];
}
