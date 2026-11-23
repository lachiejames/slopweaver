/**
 * The done-check an ask row carries when the verb that makes the row can write one: has the owner posted after
 * the Slack message the ask is anchored to.
 *
 * One function, two readers. `handover register` writes its output into the row's `doneWhen`, and
 * `handover currency` recognises the row's check by EXACT equality with it, so the currency check — the tick's or
 * the Queue opening's — evaluates this one check in-process and never runs a doc's shell. A row whose `doneWhen` was
 * hand-edited stops matching and reads "declared, not run by the currency check" — the honest outcome for a command
 * nothing vetted.
 */
import { parseSlackThreadPermalink } from "../live/slack/permalink.js";

/**
 * Characters a Slack message link is made of. Anything else — a quote, a space, a `$`, a newline — would have
 * to be escaped inside the shell string below, and a link carrying one is not a link Slack produced.
 */
const SHELL_INERT_LINK = /^[A-Za-z0-9:/.?&=_%-]+$/;

/**
 * The `command:` a row anchored at `anchor` declares as its done-check.
 *
 * @param anchor the row's anchor, absent when nobody recorded one
 * @returns the shell command, or `undefined` when the anchor is not a Slack message link this can check —
 *   a transcript pointer, a pull request, or nothing at all
 */
export function askDoneCommand({ anchor }: { anchor: string | undefined }): string | undefined {
  if (anchor === undefined || !SHELL_INERT_LINK.test(anchor)) {
    return undefined;
  }
  if (parseSlackThreadPermalink({ permalink: anchor }).isErr()) {
    return undefined;
  }
  return `slopweaver slack replied --url '${anchor}' | grep -q '^replied at '`;
}
