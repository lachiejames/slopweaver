/**
 * The Datadog SCREENSHOT floor: a message or card that cites a Datadog console page carries at least one
 * picture, or it is refused before it is sent or parked.
 *
 * ## The ruling
 *
 * An as-me thread reply cited a Datadog logs view with no picture. Any message talking about Datadog carries
 * the screenshot, and a steer that never stuck is
 * what doctrine rule 7 moves out of review and into the form, so this is a floor, not a question.
 *
 * ## How it sits beside the three-picture floor
 *
 * `../assistant/graphFindings.ts` already asks THREE distinct screenshots of a measured answer citing a graph
 * view, and `../assistant/graphFindingFloor.ts` three of every bot `finding` card. Those floors stand. This one
 * is wider and lower: ANY Datadog console URL, on any path, owes ONE picture, on every surface the owner reads —
 * every as-me send (its drip, one-card and one-list forms and a plain `--body` alike), a composed bot card, and
 * both lanes of `slack draft record`. A plain body is covered on purpose: the ruling names every draft.
 *
 * ## The criterion, read off the content
 *
 * "Cites Datadog" is a URL on a real Datadog CONSOLE host (`../../datadog/config.ts`'s `isDatadogConsoleHost`),
 * found anywhere in the form but under an `images` or `media` key (file paths): a link run, a bare URL, a citation, a `primaryLink`. The
 * walk is the whole value rather than a list of fields, for the reason `graphFindings.ts` records — review found
 * a new field each round when it was a list. A docs or API host is not a console page and is not a citation of
 * evidence. "Carries the screenshot" is an attachment whose BYTES decode as a picture, counted by the caller: a
 * PDF or a video is not a screenshot.
 *
 * The stated residue: a message that talks about Datadog without carrying its URL is not detected, and a
 * picture proves only that a picture is attached, not that it shows the page cited.
 */
import { isDatadogConsoleHost } from "../../datadog/config.js";

/** How many pictures a message citing Datadog carries at least — the screenshot. */
const DATADOG_CITATION_MIN_PICTURES = 1;

/** Where a URL can start: every spelling `new URL` accepts for http(s) opens with one of these, in any case. */
const URL_START = /https?:/gi;

/** A trailing sentence mark, bracket or quote that ends the prose around a URL rather than the URL. */
const PROSE_TAIL = /[.,;:!?)\]'"`>]+$/;

/** Slack's own `<url|label>` markup, and the characters that delimit a URL written into it. */
const MARKUP_CUT = /[<>|"]/;

/**
 * The keys whose values no reader sees, so never a citation: the local file paths a send attaches, a citation's
 * `id` and the `citationId` a run points at it by (the reader sees its label and `url`), and its `sourceRef`,
 * belief-layer metadata no renderer prints (`./types.ts`).
 */
const UNSHOWN_KEYS: ReadonlySet<string> = new Set(["citationId", "id", "images", "media", "sourceRef"]);

/** What the URL standard strips from anywhere in an address before parsing it: ASCII tab and newline. */
const URL_STRIPPED = /[\t\n\r]/g;

/**
 * Whether a URL opens a page on the Datadog console: http(s), which the console redirects, on a real console
 * host for any site. The path is not read — a logs view, a monitor and a dashboard are all a page the owner wants shown.
 *
 * @param url an absolute URL; one that does not parse answers false
 * @returns true for a Datadog console page
 */
export function isDatadogConsoleUrl({ url }: { url: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "https:" || parsed.protocol === "http:") && isDatadogConsoleHost({ hostname: parsed.hostname })
  );
}

/**
 * The URL one whitespace-delimited token carries from one `http(s):` onwards that `matches` accepts, judged by
 * the classifier itself rather than by a pattern of what a URL looks like.
 *
 * @returns the first accepted reading — prose tail dropped, as written, cut at markup — or undefined
 */
function urlFrom({ from, matches }: { from: string; matches: (args: { url: string }) => boolean }): string | undefined {
  const [markup = from] = from.split(MARKUP_CUT);
  return [from.replace(PROSE_TAIL, ""), from, markup.replace(PROSE_TAIL, "")].find((url) => matches({ url }));
}

/**
 * Every URL `matches` accepts anywhere in a form value except under an `images` or `media` key, which hold file
 * paths rather than anything a reader sees.
 *
 * @param value the form, or any part of it
 * @param matches the classifier a URL has to satisfy
 * @returns the accepted URLs in walk order, duplicates kept
 */
export function formUrlsWhere({
  value,
  matches,
}: {
  value: unknown;
  matches: (args: { url: string }) => boolean;
}): readonly string[] {
  if (typeof value === "string") {
    return value
      .replace(URL_STRIPPED, "")
      .split(/\s+/)
      .flatMap((token) =>
        [...token.matchAll(URL_START)].map((match) => urlFrom({ from: token.slice(match.index), matches })),
      )
      .filter((url) => url !== undefined);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => formUrlsWhere({ matches, value: item }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      UNSHOWN_KEYS.has(key) ? [] : formUrlsWhere({ matches, value: item }),
    );
  }
  return [];
}

/** What the floor decided about one message. */
export type DatadogScreenshotAssessment =
  | { readonly kind: "not-cited" }
  | { readonly kind: "shown"; readonly urls: readonly string[] }
  | { readonly kind: "missing-screenshot"; readonly urls: readonly string[] };

/**
 * Judge one message against the floor. Pure: the caller counts the pictures it will really attach.
 *
 * @param value the whole form or artifact, walked for Datadog console URLs in every field but `images` and `media`
 * @param pictureCount how many attachments decode as a picture
 * @returns `not-cited`, or `shown`/`missing-screenshot` with the Datadog URLs that made it a citation
 */
export function datadogScreenshotAssessment({
  value,
  pictureCount,
}: {
  value: unknown;
  pictureCount: number;
}): DatadogScreenshotAssessment {
  const urls = [...new Set(formUrlsWhere({ matches: isDatadogConsoleUrl, value }))];
  if (urls.length === 0) {
    return { kind: "not-cited" };
  }
  return pictureCount >= DATADOG_CITATION_MIN_PICTURES ? { kind: "shown", urls } : { kind: "missing-screenshot", urls };
}

/**
 * The refusal line for a `missing-screenshot` assessment — one shape for every door that enforces the floor.
 *
 * @param urls the Datadog URLs the message cites
 * @param remedy how this surface attaches a picture, in the caller's own spelling
 * @returns the refusal, naming the citation, the ruling and the two ways out
 */
export function datadogScreenshotRefusal({ urls, remedy }: { urls: readonly string[]; remedy: string }): string {
  const [first = ""] = urls;
  const more = urls.length > 1 ? ` and ${String(urls.length - 1)} more` : "";
  return (
    `this message cites Datadog (${first}${more}) and attaches no picture; a Datadog citation carries its ` +
    "screenshot, whenever Datadog is the subject. Take it with " +
    "`slopweaver datadog shot explorer --url <link>`, record it with `slopweaver browser image-record`, and " +
    `${remedy}, or take the Datadog link out. A PDF or a video is not a screenshot.`
  );
}
