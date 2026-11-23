/**
 * The band at the top of the messenger: what the owner is looking at, and what the voice actually knows about it. Its
 * layout is layout A of `$SLOPWEAVER_HOME/pages/messenger-recut-mockups/index.html`.
 *
 * Pure, so every moment on that page is a table row in a test rather than a state somebody has to reach on the real
 * app. The band only ever claims what a settled tool call proved: a page that was merely open reads "hasn't yet", and
 * a look is credited to the application it landed on and to no other.
 *
 * The front application's window title is drawn here and no text carries it further: it is in no tool output, relay,
 * prompt or call file. A frame the owner asks for shows the band as drawn, beside the window it names
 * (`docs/console/voice-notices-drift.md`).
 */

/**
 * How often the band reads what is in front while the messenger is open. Its own clock, never the drift watch's 15s:
 * at 15s a page change in Chrome took that long to show and read as wrong, which hurts trust in the band. One read is one
 * `osascript` run, MEASURED at ~0.08s of CPU (user 0.05, sys 0.03) and ~0.23s wall, so this costs about 4% of one core, and only
 * while the messenger is open. Reproduce: write `FRONT_WINDOW_PROGRAM` (`desktop/src/frontWindow.ts`) to a file, then
 * `/usr/bin/time -p /usr/bin/osascript -l JavaScript <file>`.
 */
export const FRONT_APP_BAND_POLL_MS = 2_000;

/** The colour a band's left edge and eyebrow take. */
export type MessengerBandTone = "slopweaver" | "slack" | "chrome" | "cmux" | "other";

/** How much of the thing in front the voice has read: the glyph beside the words. */
export type MessengerSightFill = "none" | "half" | "full";

/** The application in front of the owner, as one sample of the band's own channel. */
export interface FrontAppBandSample {
  /** The application's name. */
  readonly app: string;
  /** Its bundle id, when macOS gave one. */
  readonly bundleId: string | null;
  /** Its frontmost window's title, when macOS gave one. Display-only: never model-bound. */
  readonly title: string | null;
  /** The instant this sample was taken. */
  readonly sampledAtIso: string;
  /** What a look is credited to, so a window change within one application keeps the credit. */
  readonly appKey: string;
  /**
   * `front` when it is the application in front; `before-messenger` when the messenger itself has the focus and this is
   * the last application the shell saw before it — never called the one in front (the band would name an application that is not in front, which is plainly wrong),
   * and never called the one behind the messenger either, which the shell did not measure.
   */
  readonly place: "front" | "before-messenger";
}

/** What one settled tool call established, before the instant it settled at is attached. */
export type MessengerReadSubject =
  | { readonly kind: "page"; readonly path: string; readonly open: string | undefined }
  | { readonly kind: "card"; readonly key: string }
  | { readonly kind: "slack-thread" }
  | { readonly kind: "slack-channel" }
  | { readonly kind: "screen"; readonly appKey: string };

/** One thing the voice has read in this conversation, and when. */
export type MessengerRead = MessengerReadSubject & { readonly atIso: string };

/** Everything the band draws. */
export interface MessengerBand {
  /** Which of the three subjects the band is about. */
  readonly kind: "page" | "card" | "app";
  /** The small line above the title. */
  readonly eyebrow: string;
  /** What the owner is looking at. */
  readonly title: string;
  /** The colour of the left edge and the eyebrow. */
  readonly tone: MessengerBandTone;
  /** What the voice has read of it. */
  readonly sight: { readonly fill: MessengerSightFill; readonly words: string };
}

/** The application names and bundle ids that have a colour of their own, tested in order. */
const APP_TONES: readonly { readonly tone: MessengerBandTone; readonly bundle: RegExp; readonly name: RegExp }[] = [
  { bundle: /^com\.tinyspeck\.slackmacgap/, name: /^slack$/i, tone: "slack" },
  { bundle: /^com\.google\.Chrome/, name: /^google chrome$|^chrome$/i, tone: "chrome" },
  { bundle: /cmux/i, name: /^cmux$/i, tone: "cmux" },
  { bundle: /slopweaver/i, name: /^slopweaver$/i, tone: "slopweaver" },
];

/** The query parameters that say which card or panel is open, rather than which page this is. */
const CARD_QUERY_PARAMS: ReadonlySet<string> = new Set(["open", "by", "back"]);

/**
 * The colour an application's band takes.
 *
 * @param app the application's name
 * @param bundleId its bundle id, which wins over the name when it is present
 * @returns the tone, `other` for an application with no colour of its own
 */
export function toneOfApp({ app, bundleId }: { app: string; bundleId: string | null }): MessengerBandTone {
  const matched = APP_TONES.find((row) => (bundleId === null ? row.name.test(app) : row.bundle.test(bundleId)));
  return matched === undefined ? "other" : matched.tone;
}

/**
 * What a look at this application is credited to.
 *
 * @param app the application's name, used only when there is no bundle id
 * @returns a stable key for the application, independent of its window title
 */
export function appKeyOf({ app, bundleId }: { app: string; bundleId: string | null }): string {
  if (bundleId === null) {
    return `name:${app.toLowerCase()}`;
  }
  return bundleId;
}

/**
 * The same page whichever window names it. The console window's path carries no query and the overlay's carried path
 * does, and a card opening changes `open` without changing the page.
 *
 * @param path a path with an optional query
 * @returns the path with its card parameters gone and the rest in a stable order
 */
export function pageKeyOf({ path }: { path: string }): string {
  const at = path.indexOf("?");
  if (at === -1) {
    return path;
  }
  const pathname = path.slice(0, at);
  const query = path.slice(at + 1);
  const kept = [...new URLSearchParams(query).entries()]
    .filter(([name]) => !CARD_QUERY_PARAMS.has(name))
    .map(([name, value]) => `${name}=${value}`)
    .toSorted();
  return kept.length === 0 ? pathname : `${pathname}?${kept.join("&")}`;
}

/**
 * How long ago something happened, in the band's words.
 *
 * @param atIso the instant it happened
 * @param nowMs the instant to read it from
 * @returns `just now`, seconds, minutes or hours
 */
export function ageWords({ atIso, nowMs }: { atIso: string; nowMs: number }): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(atIso)) / 1000));
  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${String(seconds)} seconds ago`;
  }
  if (seconds < 3600) {
    return `${String(Math.floor(seconds / 60))} min ago`;
  }
  return `${String(Math.floor(seconds / 3600))} hr ago`;
}

/**
 * An application's band title: its name, and its window's title when that adds anything.
 *
 * @param front the sample
 * @returns `App · Window title`, or the name alone for a missing, empty or duplicate title
 */
function appTitleOf({ front }: { front: FrontAppBandSample }): string {
  const title = front.title === null ? "" : front.title.trim();
  if (title === "" || title.toLowerCase() === front.app.toLowerCase()) {
    return front.app;
  }
  return `${front.app} · ${title}`;
}

/**
 * What has been read out of Slack, in the band's words: a whole thread outranks a channel's newest messages, since a
 * channel read is how a thread with no link on screen is found and the thread read is the one that follows it. Joined to
 * a look's line rather than hidden behind it, so a typed "look at my screen, find the thread" shows both acts.
 */
function slackReadWords({
  reads,
}: {
  reads: readonly MessengerRead[];
}): "read the thread" | "read the channel" | undefined {
  if (reads.some((read) => read.kind === "slack-thread")) {
    return "read the thread";
  }
  if (reads.some((read) => read.kind === "slack-channel")) {
    return "read the channel";
  }
  return undefined;
}

/** The band while another application is in front. */
function appBand({
  front,
  reads,
  canLook,
  nowMs,
}: {
  front: FrontAppBandSample;
  reads: readonly MessengerRead[];
  canLook: boolean;
  nowMs: number;
}): MessengerBand {
  const tone = toneOfApp({ app: front.app, bundleId: front.bundleId });
  let eyebrow = "App in front";
  if (front.place === "before-messenger") {
    eyebrow = "Last app before messenger";
  }
  const base = { eyebrow, kind: "app", title: appTitleOf({ front }), tone } as const;
  const look = reads.findLast((read) => read.kind === "screen" && read.appKey === front.appKey);
  const slackRead = tone === "slack" ? slackReadWords({ reads }) : undefined;
  if (look !== undefined) {
    const looked = `Looked at your screen ${ageWords({ atIso: look.atIso, nowMs })}`;
    return { ...base, sight: { fill: "full", words: slackRead === undefined ? looked : `${looked} · ${slackRead}` } };
  }
  if (slackRead === "read the thread") {
    return { ...base, sight: { fill: "half", words: "Read the thread · not the rest of Slack" } };
  }
  if (slackRead === "read the channel") {
    return { ...base, sight: { fill: "half", words: "Read a channel's newest messages · not the rest of Slack" } };
  }
  if (canLook) {
    return { ...base, sight: { fill: "half", words: "Can look when you ask · hasn't looked" } };
  }
  return { ...base, sight: { fill: "none", words: "Name only" } };
}

/** What the voice has read of a page or card, in the band's words. */
function readSight({
  noun,
  read,
  nowMs,
}: {
  noun: "page" | "card";
  read: MessengerRead | undefined;
  nowMs: number;
}): MessengerBand["sight"] {
  if (read === undefined) {
    return { fill: "half", words: `Can read this ${noun} · hasn't yet` };
  }
  return { fill: "full", words: `Read this ${noun} ${ageWords({ atIso: read.atIso, nowMs })}` };
}

/**
 * The band for this moment. The application in front wins; with none, the open card; with none, the page.
 *
 * @param page the Slopweaver page in the console window
 * @param openCard the card open on that page, whose title the band needs in order to name it
 * @param front the other application in front of the owner, `undefined` when Slopweaver is
 * @param reads everything read in this conversation, oldest first
 * @param canLook whether a screen look can actually be taken right now
 * @param nowMs the instant the ages are read from
 * @returns what to draw
 */
export function messengerBand({
  page,
  openCard,
  front,
  reads,
  canLook,
  nowMs,
}: {
  page: { readonly path: string; readonly title: string };
  openCard: { readonly key: string; readonly title: string | undefined } | undefined;
  front: FrontAppBandSample | undefined;
  reads: readonly MessengerRead[];
  canLook: boolean;
  nowMs: number;
}): MessengerBand {
  if (front !== undefined) {
    return appBand({ canLook, front, nowMs, reads });
  }
  if (openCard?.title !== undefined) {
    const read = reads.findLast(
      (item) =>
        (item.kind === "card" && item.key === openCard.key) || (item.kind === "page" && item.open === openCard.key),
    );
    return {
      eyebrow: `${page.title} · card`,
      kind: "card",
      sight: readSight({ noun: "card", nowMs, read }),
      title: openCard.title,
      tone: "slopweaver",
    };
  }
  const pageKey = pageKeyOf({ path: page.path });
  const isPublished = page.path === "/view" || page.path.startsWith("/view?");
  const read = reads.findLast((item) => item.kind === "page" && pageKeyOf({ path: item.path }) === pageKey);
  return {
    eyebrow: isPublished ? "Page" : page.title,
    kind: "page",
    sight: readSight({ noun: "page", nowMs, read }),
    title: page.title,
    tone: "slopweaver",
  };
}

/**
 * Everything read so far, off the conversation's tool lines.
 *
 * @param lines the tool lines, oldest first; a line carrying no `knowledge` established nothing
 * @returns the reads, oldest first
 */
export function messengerReadsOf({
  lines,
}: {
  lines: readonly { readonly settledAtIso?: string; readonly knowledge?: MessengerReadSubject }[];
}): readonly MessengerRead[] {
  return lines.flatMap((line) =>
    line.knowledge === undefined || line.settledAtIso === undefined
      ? []
      : [{ ...line.knowledge, atIso: line.settledAtIso }],
  );
}

/**
 * The sample already drawn, the instant the messenger takes the focus: whatever was in front a moment ago is now the
 * last application before it. Applied before the read the focus starts settles, so "App in front" is never on screen
 * while the messenger has the focus, not even for that read's ~0.23s.
 *
 * @param front the sample drawn now, `undefined` for none
 * @returns the same sample placed before the messenger, or `undefined` for none
 */
export function focusedFrontAppBand({
  front,
}: {
  front: FrontAppBandSample | undefined;
}): FrontAppBandSample | undefined {
  if (front === undefined || front.place === "before-messenger") {
    return front;
  }
  return { ...front, place: "before-messenger" };
}

/**
 * The band's channel reply, read strictly: only an application sample — in front, or the last one before the
 * messenger — is a sample. A shell from before the `behind` reply answers the application it kept as `app` while the
 * messenger has the focus, so an `app` read while the messenger is focused is taken as the one before it: Slopweaver is
 * in front then, whatever that shell says.
 *
 * @param value what the desktop shell answered
 * @param sampledAtIso the instant the sample was taken
 * @param messengerFocused the voice's window held the focus as the read settled
 * @returns the sample, or `undefined` when Slopweaver's console is in front or the reply is unusable — the band then
 *   draws the page or card
 */
export function frontAppBandOf({
  value,
  sampledAtIso,
  messengerFocused,
}: {
  value: unknown;
  sampledAtIso: string;
  messengerFocused: boolean;
}): FrontAppBandSample | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return undefined;
  }
  let place: FrontAppBandSample["place"];
  if (value.kind === "behind" || (value.kind === "app" && messengerFocused)) {
    place = "before-messenger";
  } else if (value.kind === "app") {
    place = "front";
  } else {
    return undefined;
  }
  const fields: Record<string, unknown> = { ...value };
  const { app, bundleId, title } = fields;
  const namesAnApp = typeof app === "string" && app !== "" && app.length <= 60;
  const bundleOk = bundleId === null || (typeof bundleId === "string" && bundleId.length <= 200);
  const titleOk = title === null || (typeof title === "string" && title.length <= 200);
  if (!namesAnApp || !bundleOk || !titleOk) {
    return undefined;
  }
  return { app, appKey: appKeyOf({ app, bundleId }), bundleId, place, sampledAtIso, title };
}
