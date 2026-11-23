/**
 * What the stage's activity line says the voice is consulting: one compact line by the orb, naming the tool's
 * subject — the card, the file, the owner's screen, the supervisor — with a thumbnail when it is looking at a picture.
 *
 * The orb gives visual feedback on what the voice is consulting, as a mobile chat app does when it searches or looks
 * at an image: a compact line, with a thumbnail of the image when there is one, expandable on request. A whole card
 * is not drawn, since it adds little: its title and the decision it needs, at most.
 *
 * Pure: `VoiceProvider` starts a line as each tool starts and hands it the picture the answer carried.
 */
import { type Bag, isBag, str, sub } from "./bag";
import type { HeardSegment } from "./voiceTranscript";

/** What the voice is consulting, as the activity line draws it. */
export interface Consultation {
  /** The tool call's token, so its answer refines the line it started. */
  readonly token: string;
  readonly tool: string;
  /** What it is doing, in a few words: "looking at your screen". */
  readonly doing: string;
  /** What it is doing it to — a card's title, a file's name — or `undefined` when the call names nothing. */
  readonly subject: string | undefined;
  /** The decision a Queue card needs, when the subject is one, for the expanded line. */
  readonly decision: string | undefined;
  /** The id of the owner's newest stretch of speech when it began: the line stays until the owner speaks again. */
  readonly after: string | undefined;
  /** The picture the tool handed the model, as a data URL, once its answer carries one: the thumbnail. */
  readonly picture: string | undefined;
}

/** What a tool call tells the line before it runs. */
export interface ConsultationStart {
  readonly token: string;
  readonly tool: string;
  /** The model's JSON arguments, verbatim; a malformed one names no subject. */
  readonly rawArguments: string;
  /** What the page registered for the voice to read (`PageView.shows`): on the Queue, `open` is the open card. */
  readonly pageShows: unknown;
  /**
   * What a look at the owner's screen would be of: the owner's share's surface, or the desktop app's own whole-screen look;
   * `undefined` when the voice has no way to see it.
   */
  readonly screen: string | undefined;
  readonly segments: readonly HeardSegment[];
}

/** The words for each tool the owner will see named; anything else reads "running <tool>". */
const DOING: Readonly<Partial<Record<string, string>>> = {
  action_items: "going through your Queue",
  board_row: "reading the board",
  browser: "in your browser",
  browser_open: "opening it for you",
  code_find: "searching the code",
  code_list: "looking through the code",
  code_read: "reading the code",
  file_list: "looking through your files",
  file_read: "reading a file",
  glossary: "looking up a word",
  knowledge: "looking at what we already know",
  meeting_skip: "noting that meeting is off for you",
  open_card: "opening the card",
  origin: "tracing where it came from",
  read_card: "reading the card",
  read_page: "reading the page",
  read_screen: "looking at your screen",
  focus_screen: "showing you where",
  offer_copy: "putting a message on your running list",
  read_supervisor: "reading the supervisor's chat",
  recall: "searching what you said",
  recall_open: "opening what you said",
  recent_steers: "reading your recent steers",
  relay_steer: "relaying to the supervisor",
  set_stage_setting: "changing your call settings",
  slack_channel: "reading the Slack channel",
  slack_open: "opening the Slack thread",
  slack_thread_after: "reading the Slack thread",
  slack_unread: "checking your unread Slack",
  supervisor_history: "reading the supervisor's history",
  verb: "running a read",
};

/** The argument that names each tool's subject, where one does. */
const SUBJECT_ARG: Readonly<Partial<Record<string, string>>> = {
  board_row: "slug",
  browser_open: "url",
  code_find: "query",
  code_list: "path",
  code_read: "path",
  file_list: "path",
  file_read: "path",
  glossary: "term",
  knowledge: "query",
  origin: "slug",
  recall: "words",
  set_stage_setting: "setting",
  slack_channel: "channel",
  slack_open: "url",
  slack_thread_after: "url",
};

/** The JSON arguments as a bag, or `undefined` when they are not an object. */
function argsOf({ rawArguments }: { rawArguments: string }): Bag | undefined {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    return isBag(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A path's last part: the file's own name, which is what the owner would recognise. */
function lastPart({ path }: { path: string }): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  const last = parts.at(-1);
  if (last === undefined) {
    return path;
  }
  return last;
}

/** The first of a card's fields that says something: an empty or blank field never stands in front of the next. */
function firstSaid({ bag, keys }: { bag: Bag; keys: readonly string[] }): string | undefined {
  return keys.map((key) => str({ bag, key })).find((text) => text !== undefined && text.trim().length > 0);
}

/** The open card's title and the decision it needs, each on its own, read defensively off the page's reading. */
function cardOf({
  pageShows,
}: {
  pageShows: unknown;
}): { subject: string | undefined; decision: string | undefined } | undefined {
  if (!isBag(pageShows)) {
    return undefined;
  }
  const openCard = sub({ bag: pageShows, key: "open" });
  if (openCard === undefined) {
    return undefined;
  }
  return {
    decision: firstSaid({ bag: openCard, keys: ["problem", "question"] }),
    subject: firstSaid({ bag: openCard, keys: ["subject"] }),
  };
}

/**
 * The verb a `verb` call runs, as the owner would type it: its arguments nest it as `{ request: { noun, verb } }`, which no flat
 * key reaches. "Ran a verb" alone is useless with a thousand verbs, so the line names which one — the call file
 * already named it (`talkToolCalls.ts`'s `detailOf`).
 */
function verbSubject({ args }: { args: Bag }): string | undefined {
  const request = sub({ bag: args, key: "request" });
  if (request === undefined) {
    return undefined;
  }
  const noun = str({ bag: request, key: "noun" });
  const verb = str({ bag: request, key: "verb" });
  if (noun === undefined || verb === undefined || noun.trim() === "" || verb.trim() === "") {
    return undefined;
  }
  return `slopweaver ${noun} ${verb}`;
}

/** The subject a tool's own arguments name, when they name one. */
function argSubject({ tool, args }: { tool: string; args: Bag | undefined }): string | undefined {
  if (tool === "verb" && args !== undefined) {
    return verbSubject({ args });
  }
  const key = SUBJECT_ARG[tool];
  if (key === undefined || args === undefined) {
    return undefined;
  }
  const value = str({ bag: args, key });
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  if (key === "path") {
    return lastPart({ path: value });
  }
  return value;
}

/**
 * The line a tool call starts: what it is doing, and to what.
 *
 * @returns the consultation to draw
 */
export function consultationOf({
  token,
  tool,
  rawArguments,
  pageShows,
  screen,
  segments,
}: ConsultationStart): Consultation {
  let doing = `running ${tool}`;
  const named = DOING[tool];
  if (named !== undefined) {
    doing = named;
  }
  let subject = argSubject({ args: argsOf({ rawArguments }), tool });
  let decision: string | undefined;
  const card = cardOf({ pageShows });
  const aboutCard = tool === "read_page" || tool === "relay_steer";
  if (aboutCard && card !== undefined) {
    if (card.subject !== undefined) {
      subject = card.subject;
    }
    decision = card.decision;
  }
  if (tool === "read_screen" && screen !== undefined) {
    subject = screen;
  }
  const newest = segments.findLast((segment) => segment.who === "owner");
  return { after: newest?.id, decision, doing, picture: undefined, subject, token, tool };
}

/**
 * Whether the line still shows: from the moment the tool starts, through the voice's answer about it, until the owner
 * starts a new stretch of speech — so a thumbnail never flashes away the instant its tool returns.
 *
 * @param consultation the line, when there is one
 * @param segments the conversation now
 * @returns true while it still belongs to the exchange it began in
 */
export function consultationShows({
  consultation,
  segments,
}: {
  consultation: Consultation | undefined;
  segments: readonly HeardSegment[];
}): boolean {
  if (consultation === undefined) {
    return false;
  }
  const newest = segments.findLast((segment) => segment.who === "owner");
  return newest?.id === consultation.after;
}

/**
 * The picture an answer handed the model, when it handed one: the `input_image` part a screen frame or an image
 * file becomes (`screenGrab.ts`, `fileImageGrab.ts`).
 *
 * @param image the answer's content parts, or `undefined` for a text-only answer
 * @returns the image's data URL, or `undefined`
 */
export function pictureOf({ image }: { image: readonly unknown[] | undefined }): string | undefined {
  if (image === undefined) {
    return undefined;
  }
  for (const part of image) {
    if (isBag(part) && part["type"] === "input_image") {
      const url = str({ bag: part, key: "image_url" });
      if (url?.startsWith("data:image/") === true) {
        return url;
      }
    }
  }
  return undefined;
}

/**
 * The line once its tool has answered: the same line, now carrying the picture the answer handed the model. An
 * answer to an older call — overtaken by a newer line — changes nothing.
 *
 * @param consultation the line drawn now
 * @param token the answered call's token
 * @param image the answer's content parts, or `undefined` for a text-only answer
 * @returns the line to draw
 */
export function consultationAnswered({
  consultation,
  token,
  image,
}: {
  consultation: Consultation | undefined;
  token: string;
  image: readonly unknown[] | undefined;
}): Consultation | undefined {
  if (consultation?.token !== token) {
    return consultation;
  }
  const picture = pictureOf({ image });
  if (picture === undefined) {
    return consultation;
  }
  return { ...consultation, picture };
}
