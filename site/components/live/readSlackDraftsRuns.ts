/**
 * One rich-text inline element of a parked draft as a run, and the field checks every reader of a draft row shares.
 */
import { type Bag, bags, num, str, sub } from "../../lib/bag";
import { emojiUnicodeGlyph, isSkinTone, type SlackSkinTone } from "../../lib/slackEmoji";

/** One inline run of a parked message: every inline element a `rich_text` block may carry. */
export type DraftRun =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly bold: boolean;
      readonly italic: boolean;
      readonly code: boolean;
    }
  | { readonly kind: "link"; readonly url: string; readonly label: string }
  | { readonly kind: "user"; readonly userId: string }
  | {
      readonly kind: "usergroup";
      readonly groupId: string;
      /**
       * The `@handle` mrkdwn wire text writes beside the id (`<!subteam^S…|@handle>`), unescaped; a rich-text
       * `usergroup` element carries none. Required, so every reader states whether it had one.
       */
      readonly handle: string | undefined;
    }
  | {
      readonly kind: "emoji";
      readonly name: string;
      /** Slack's own hex spelling of a standard emoji, tone included (`1f44b-1f3fd`); a custom emoji carries none. */
      readonly unicode: string | undefined;
      /** The `skin_tone` Slack records beside the name, 2 to 6. */
      readonly skinTone: SlackSkinTone | undefined;
    }
  | { readonly kind: "broadcast"; readonly range: string }
  | { readonly kind: "channel"; readonly channelId: string }
  | { readonly kind: "team"; readonly teamId: string }
  /** A date Slack localises for each reader; the card draws the author's fallback text, else the raw instant. */
  | { readonly kind: "date"; readonly label: string; readonly timestamp: number }
  | { readonly kind: "color"; readonly value: string };

/** One rendered line: a paragraph, one item of a list, a quote, or a code block. */
export interface DraftLine {
  readonly runs: readonly DraftRun[];
  /** The bullet or number this line carries when it belongs to a list, else nothing. */
  readonly marker: string | undefined;
  /** How many levels a list item sits in, as Slack nests one: a sub-point is `1`. Absent on a headline and a paragraph. */
  readonly indent?: number;
  /** The box Slack draws around the line: a quote's bar or a code block's frame, else nothing. */
  readonly frame: "quote" | "code" | undefined;
}

/**
 * Every style flag `@slack/types`' `RichTextStyleable` declares: the three the tile draws, and `strike` and
 * `underline`, which it does not. A present one that is not a boolean refuses, rather than drawing plain. A key the
 * SDK does not declare is ignored, never refused, since Slack may write one this reader has not met.
 */
const STYLE_FLAGS = ["bold", "code", "italic", "strike", "underline"] as const;

/** Whether a style flag is absent or a boolean — the two shapes `RichTextStyleable` allows. */
function isFlag({ value }: { value: unknown }): boolean {
  return value === undefined || typeof value === "boolean";
}

/**
 * Whether an OPTIONAL drawn field is present but not a string — malformed, which refuses, never read as absent.
 *
 * @returns true when the optional field is present but not a string
 */
export function notText({ bag, key }: { bag: Bag; key: string }): boolean {
  return bag[key] !== undefined && typeof bag[key] !== "string";
}

/**
 * Whether `bag[key]` is present but not a boolean — absent is fine, malformed is not.
 *
 * @returns true when the field is present but not a boolean
 */
export function notFlag({ bag, key }: { bag: Bag; key: string }): boolean {
  return bag[key] !== undefined && typeof bag[key] !== "boolean";
}

/** Whether an element's `style` is present but not an object of boolean flags — malformed, which refuses. */
function badStyle({ element }: { element: Bag }): boolean {
  const style = sub({ bag: element, key: "style" });
  if (element["style"] !== undefined && style === undefined) {
    return true;
  }
  return style !== undefined && !STYLE_FLAGS.every((flag) => isFlag({ value: style[flag] }));
}

/** One rich-text element as a run, or `undefined` when it is a shape this version does not draw. */
function runOf({ element }: { element: Bag }): DraftRun | undefined {
  const type = str({ bag: element, key: "type" });
  if (type === "text") {
    const text = str({ bag: element, key: "text" });
    if (text === undefined || badStyle({ element })) {
      return undefined;
    }
    const style = sub({ bag: element, key: "style" });
    return {
      bold: style?.["bold"] === true,
      code: style?.["code"] === true,
      italic: style?.["italic"] === true,
      kind: "text",
      text,
    };
  }
  if (type === "link") {
    const url = str({ bag: element, key: "url" });
    if (url === undefined) {
      return undefined;
    }
    if (notText({ bag: element, key: "text" })) {
      return undefined;
    }
    const written = str({ bag: element, key: "text" });
    const label = written ?? url;
    if (!LINK_SCHEME.test(url)) {
      // A scheme a card may not link stays words, as a mrkdwn or button link does.
      return { bold: false, code: false, italic: false, kind: "text", text: label };
    }
    return { kind: "link", label, url };
  }
  if (type === "user") {
    const userId = str({ bag: element, key: "user_id" });
    if (userId === undefined) {
      return undefined;
    }
    return { kind: "user", userId };
  }
  if (type === "usergroup") {
    const groupId = str({ bag: element, key: "usergroup_id" });
    if (groupId === undefined) {
      return undefined;
    }
    return { groupId, handle: undefined, kind: "usergroup" };
  }
  if (type === "emoji") {
    return emojiRunOf({ element });
  }
  if (type === "broadcast") {
    const range = str({ bag: element, key: "range" });
    if (range === undefined) {
      return undefined;
    }
    return { kind: "broadcast", range };
  }
  return otherRunOf({ element, type });
}

/**
 * A rich-text `emoji` element as a run: its name, and the `unicode` and `skin_tone` Slack records beside it, so the
 * card draws the emoji Slack would. Either may be absent; a present one of the wrong shape refuses, as every field here.
 * A well-formed `unicode` is never checked against the name, by decision: a workspace alias over a standard emoji
 * carries the alias's name and the base's unicode, and Slack's own record is what its client draws.
 */
function emojiRunOf({ element }: { element: Bag }): DraftRun | undefined {
  const name = str({ bag: element, key: "name" });
  const tone = element["skin_tone"];
  if (name === undefined || notText({ bag: element, key: "unicode" }) || badStyle({ element })) {
    return undefined;
  }
  const unicode = str({ bag: element, key: "unicode" });
  // A spelling that is not code points is malformed, never read as absent and drawn by name instead.
  if (unicode !== undefined && emojiUnicodeGlyph({ unicode }) === undefined) {
    return undefined;
  }
  if (tone !== undefined && !isSkinTone(tone)) {
    return undefined;
  }
  return { kind: "emoji", name, skinTone: tone, unicode };
}

/** The inline elements no as-me form writes by hand, which Slack still admits — split out to keep one reader short. */
function otherRunOf({ element, type }: { element: Bag; type: string | undefined }): DraftRun | undefined {
  if (type === "channel") {
    const channelId = str({ bag: element, key: "channel_id" });
    if (channelId === undefined) {
      return undefined;
    }
    return { channelId, kind: "channel" };
  }
  if (type === "team") {
    const teamId = str({ bag: element, key: "team_id" });
    if (teamId === undefined) {
      return undefined;
    }
    return { kind: "team", teamId };
  }
  if (type === "date") {
    const timestamp = num({ bag: element, key: "timestamp" });
    if (timestamp === undefined || notText({ bag: element, key: "fallback" })) {
      return undefined;
    }
    const fallback = str({ bag: element, key: "fallback" });
    if (fallback === undefined) {
      return { kind: "date", label: String(timestamp), timestamp };
    }
    return { kind: "date", label: fallback, timestamp };
  }
  if (type === "color") {
    const value = str({ bag: element, key: "value" });
    if (value === undefined) {
      return undefined;
    }
    return { kind: "color", value };
  }
  return undefined;
}

/**
 * One `rich_text_section`'s runs, or `undefined` when any one of them is unreadable.
 *
 * @returns every run, or undefined when any element is unreadable
 */
export function sectionRuns({ section }: { section: Bag }): readonly DraftRun[] | undefined {
  const elements = bags({ bag: section, key: "elements" });
  if (elements === undefined) {
    return undefined;
  }
  const runs: DraftRun[] = [];
  for (const element of elements) {
    const run = runOf({ element });
    if (run === undefined) {
      return undefined;
    }
    runs.push(run);
  }
  return runs;
}

/** The schemes a button or title may become a live link for; anything else stays words. */
export const LINK_SCHEME = /^(?:https?:\/\/|mailto:)/;
