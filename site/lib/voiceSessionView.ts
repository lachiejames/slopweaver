/**
 * The voice's session tray, as rows: every tool call this call made, oldest first, then what is still running at the
 * foot — the order a fleet session card reads in, newest at the bottom where the view starts (`VoiceSession.tsx`).
 * Each result is collapsed by default, as the fleet session does, so a row is a header and a fold, and nothing here
 * decides whether it is open.
 *
 * A tool line carries no id, and the voice keeps only its newest forty (`KEPT_LINES`, `VoiceProvider.tsx`), so a row's
 * key is its content and how many identical rows came before it: an index would hand a fold the owner opened to the
 * next row the moment the oldest line dropped off. Pure.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import { opensNowhere } from "./citationDisplay";
import { type TimingUsage, toolTimingWords } from "./toolTiming";
import type { ActivityRow } from "./voiceActivity";

/** One tool call's input and output as the tray draws them, the fleet card's two halves of a call. */
export interface ToolCallShown {
  /** The model's arguments, indented when they are JSON, else exactly as it wrote them. */
  readonly input: string;
  /** What the model was handed back, indented when it is JSON; a picture is named rather than drawn. */
  readonly output: string;
}

/** What a session row reads off one of the voice's tool lines (`ToolLine`, `voiceContext.ts`). */
export interface SessionToolLine {
  readonly name: string;
  readonly detail: string;
  readonly refused: boolean;
  readonly opened?: string | null;
  readonly ms: number | undefined;
  readonly usage: TimingUsage | undefined;
  readonly shown?: ToolCallShown;
}

/** What a picture the model was handed reads as in the fold, since the tray draws text. */
export const PICTURE_OUTPUT = "a picture, handed to the model as an image";

/**
 * A JSON text with every whitespace character outside a string literal removed.
 *
 * @returns the text, minified
 */
function minified({ text }: { text: string }): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      out += char;
    } else if (!/\s/u.test(char)) {
      inString = char === '"';
      out += char;
    }
  }
  return out;
}

/**
 * A JSON text indented two spaces, or the text unchanged when it is not JSON — or when parsing would change it beyond
 * whitespace (an integer past 2^53, `1.0`, a `\u` escape): the fold shows exactly what the model wrote or was handed,
 * so indenting is the only rewrite allowed.
 *
 * @returns the text to draw
 */
function indented({ text }: { text: string }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (JSON.stringify(parsed) !== minified({ text })) {
    return text;
  }
  return JSON.stringify(parsed, null, 2);
}

/**
 * What one tool call shows behind its fold: the model's arguments and the `function_call_output` it was handed, both
 * indented when they are JSON, the way a fleet card shows a Claude Code tool call's input and result. A bare tool name shows
 * too little info next to what a fleet card carries.
 *
 * @param rawArguments the arguments exactly as the model wrote them
 * @param output what the model was handed: the answer's text, or the image list a screen read sends
 * @returns the two halves
 */
export function toolCallShownOf({
  rawArguments,
  output,
}: {
  rawArguments: string;
  output: string | ResponseFunctionCallOutputItemList;
}): ToolCallShown {
  if (typeof output === "string") {
    return { input: indented({ text: rawArguments }), output: indented({ text: output }) };
  }
  return { input: indented({ text: rawArguments }), output: PICTURE_OUTPUT };
}

/**
 * Which half of the fleet card's `ToolOutput` a call's output goes in: "Error" for a refused call, whose output is its
 * refusal, else "Result".
 *
 * @param output the shown output
 * @param refused whether the call was refused
 * @returns the two props, exactly one of them set
 */
export function shownToolOutputOf({ output, refused }: { output: string; refused: boolean }): {
  readonly errorText: string | undefined;
  readonly output: string | undefined;
} {
  if (refused) {
    return { errorText: output, output: undefined };
  }
  return { errorText: undefined, output };
}

/** Where a row's call is: answered, refused, or still running. */
export type VoiceSessionRowState = "done" | "refused" | "running";

/** One row of the session tray. */
export interface VoiceSessionRow {
  readonly key: string;
  /** The header: the tool's name, or what a running turn or tool is doing. */
  readonly title: string;
  readonly state: VoiceSessionRowState;
  /** What the call came to, behind the fold; `""` for a running row, whose header already says it. */
  readonly detail: string;
  /** The round trip and usage in words, `""` when nothing was measured; a running row's age. */
  readonly timing: string;
  /** A running row with no update for long enough to say so. */
  readonly stale: boolean;
  /** The link a read opened, when it can vouch for one. */
  readonly opened: string | undefined;
  /** Whether `opened` draws as a link: an address under a page the console no longer has draws as words. */
  readonly openedLinks: boolean;
  /** The call's input and output, behind the fold; `undefined` for a line that carried none. */
  readonly shown: ToolCallShown | undefined;
}

/**
 * The tray's rows: the tool lines in the order they arrived, then the in-flight rows, oldest progress first so the
 * newest sits at the foot.
 *
 * @param tools the call's tool lines, oldest first
 * @param inFlight every turn and tool in flight, newest progress first (`activityRows`)
 * @returns the rows, top to bottom
 */
export function voiceSessionRows({
  tools,
  inFlight,
}: {
  tools: readonly SessionToolLine[];
  inFlight: readonly ActivityRow[];
}): readonly VoiceSessionRow[] {
  const seen = new Map<string, number>();
  const done = tools.map((line): VoiceSessionRow => {
    const content = `${line.name} · ${line.detail} · ${String(line.ms)}`;
    let count = 0;
    const before = seen.get(content);
    if (before !== undefined) {
      count = before;
    }
    seen.set(content, count + 1);
    let state: VoiceSessionRowState = "done";
    if (line.refused) {
      state = "refused";
    }
    let opened: string | undefined;
    let openedLinks = false;
    if (typeof line.opened === "string") {
      opened = line.opened;
      // A call kept from before Board and Machine went can name either; its address stays readable, never clickable.
      openedLinks = !opensNowhere({ reference: { kind: "address", url: line.opened } });
    }
    return {
      detail: line.detail,
      key: `tool:${content}:${String(count)}`,
      opened,
      openedLinks,
      shown: line.shown,
      stale: false,
      state,
      timing: toolTimingWords({ ms: line.ms, usage: line.usage }),
      title: line.name,
    };
  });
  const running = inFlight.toReversed().map((row): VoiceSessionRow => ({
    detail: "",
    key: `running:${row.key}`,
    opened: undefined,
    openedLinks: false,
    shown: undefined,
    stale: row.stale,
    state: "running",
    timing: `${String(row.seconds)}s`,
    title: row.words,
  }));
  return [...done, ...running];
}
