/**
 * The GitHub objects a wrapped bot message links to, written into its `fallback` as plain `owner/repo#N` so
 * Slack's search can find the message by the number.
 *
 * ## The defect
 *
 * Slack's search indexes a message's top-level `text`, its top-level `blocks` and an attachment's `fallback`.
 * It does NOT index the blocks INSIDE an attachment — and every card, answer, turn frame and poll this
 * repository sends puts its whole body there, because the wrapper is what makes the fold fire (`./types.ts`).
 * So the only searchable words on a bot card were its TL;DR, and a pull request it cited was reachable by
 * nobody searching for the number.
 *
 * MEASURED with `slopweaver slack probe --method search.messages` (user token), on the bot's ISO
 * channel answer that introduced a pull request in acme/acme-admin (`C0SYN000001` `p1789453264550529`):
 *
 * - `query=<the pull request number>` — 21 hits, none of them that answer; nor `query=github.com/acme/acme-admin/pull/<number>`.
 * - `query="went the IaC route"` (the TL;DR, so also the `fallback`) — 1 hit, that answer.
 * - `query="the zone trap does not bite here"` and `query="vanta only flips on its next hourly sync"` (body
 *   prose, attachment blocks only) — 0 hits.
 * - `query="is green but blocked, on staging"` — 1 hit, a DM card whose blocks sit at TOP level.
 *
 * Re-run any of them with `--count-where "messages.matches:permalink~<ts digits>"` to see which message a hit
 * is. The owner's guess was that the PR "came in as a citation rather than a regular link"; the citation chip
 * did hide the number (its label was `[1]`), but plain text beside it inside the wrapper would have been just
 * as invisible, which is why the fix lands in the `fallback` rather than in the card's runs.
 *
 * ## The shape of the fix
 *
 * Every numbered GitHub link anywhere in the wrapper's blocks — a `link` run's `url`, a citation chip's, a
 * mrkdwn `<url|label>` — adds one `owner/repo#N` to a line appended under the existing fallback. The first
 * line is untouched, so the push notification still opens on the TL;DR and the repeat guard's first-line
 * rule (`./repeatMatch.ts`) still compares the same words. A reference the fallback already spells is not
 * repeated, and a message linking no GitHub object keeps its fallback byte for byte.
 */
import { isRecord } from "#lib/parsers.js";

import { attestedNumbersInText } from "../linkify/bareRefs.js";
import type { SlackCardWrapper } from "./types.js";

/**
 * Every string anywhere under a value, in document order.
 *
 * @param value a rendered block tree, or any part of one
 * @returns the strings it carries, keys excluded
 */
function stringsUnder({ value }: { value: unknown }): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => stringsUnder({ value: item }));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => stringsUnder({ value: item }));
  }
  return [];
}

/**
 * The numbered GitHub objects a set of blocks links to, as `owner/repo#N`, first-seen order, each once.
 *
 * @param blocks the rendered blocks of one wrapper
 * @returns the references, deduplicated
 */
export function githubRefsInBlocks({ blocks }: { blocks: readonly unknown[] }): readonly string[] {
  const refs = stringsUnder({ value: blocks })
    .flatMap((text) => attestedNumbersInText({ text }))
    .map(({ owner, repo, number }) => `${owner}/${repo}#${String(number)}`);
  return [...new Set(refs)];
}

/**
 * An `owner/repo#N` written as a whole token — bounded on both sides, so a longer number never counts as
 * spelling a shorter prefix of it (`acme/widgets#N` and `acme/widgets#NN`), nor `bigacme/widgets#N` as spelling `acme/widgets#N`.
 */
const SPELLED_REF = /(?<![\w./-])(?<ref>[A-Za-z0-9][\w.-]*\/[\w.-]+#\d+)(?!\w)/gu;

/**
 * The `owner/repo#N` references a text already spells as whole tokens.
 *
 * @param text the fallback as the renderer chose it
 * @returns each reference spelled, as written
 */
function spelledRefs({ text }: { text: string }): ReadonlySet<string> {
  return new Set(
    [...text.matchAll(SPELLED_REF)].flatMap((match) => {
      const ref = match.groups?.["ref"];
      return ref === undefined ? [] : [ref];
    }),
  );
}

/**
 * A fallback with every GitHub object its blocks link to appended as plain, searchable `owner/repo#N`.
 *
 * @param fallback the notification line the renderer chose, normally the TL;DR
 * @param blocks the blocks the same wrapper carries
 * @returns the fallback unchanged when the blocks link nothing new; otherwise the fallback, a newline, and the
 *   references it did not already spell as whole tokens, space-separated
 */
export function searchableFallback({ fallback, blocks }: { fallback: string; blocks: readonly unknown[] }): string {
  const spelled = spelledRefs({ text: fallback });
  const missing = githubRefsInBlocks({ blocks }).filter((ref) => !spelled.has(ref));
  if (missing.length === 0) {
    return fallback;
  }
  return `${fallback}\n${missing.join(" ")}`;
}

/**
 * A wrapper whose `fallback` carries the GitHub references its blocks link to — the one call every wrapper
 * constructor makes, so no bot message cites a pull request search cannot find.
 *
 * @param wrapper the built wrapper
 * @returns the same wrapper with {@link searchableFallback} applied
 */
export function withSearchableFallback({ wrapper }: { wrapper: SlackCardWrapper }): SlackCardWrapper {
  return { ...wrapper, fallback: searchableFallback({ blocks: wrapper.blocks, fallback: wrapper.fallback }) };
}
