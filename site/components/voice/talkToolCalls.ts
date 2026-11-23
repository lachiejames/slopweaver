/**
 * The two console routes a voice tool call reaches — `/api/talk/tool/<name>` for a verb tool, `/api/talk/relay`
 * for a steer — and the parse of the model's arguments. `VoiceProvider` decides WHEN each runs; this file only
 * says what one round trip came to.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import { type Bag, isBag, str } from "../../lib/bag";
import { type RelayReport, relayedLine, relayReportOf } from "../../lib/relayAnswer";
import { toolStepName } from "../../lib/talkPlanProtocolTurns";
import { relayWireForInstance, type TalkRelayWire } from "../../lib/talkRelayRequestWire";
import { openedLinkOf, readsLink } from "../../lib/talkTools";
import { toolCallShownOf } from "../../lib/voiceSessionView";
import type { RelayLine, ToolLine } from "./voiceContext";

/**
 * The name the page's own pending-tool row shows for a call: the verb a `verb` call runs, read off its arguments
 * exactly as the executor reads them (`argsOf`), so it agrees with the Codex step for the same call.
 *
 * @param tool the tool the model called
 * @param rawArguments the call's arguments as the page received them, a JSON string
 * @returns the row's name
 */
export function pendingToolName({ tool, rawArguments }: { tool: string; rawArguments: string }): string {
  return toolStepName({ args: argsOf({ rawArguments }), tool });
}

/**
 * The model's arguments as an object, or `undefined` when they are not one.
 *
 * @param rawArguments the string exactly as the model produced it
 * @returns the parsed object
 */
export function argsOf({ rawArguments }: { rawArguments: string }): Record<string, unknown> | undefined {
  try {
    const held: unknown = JSON.parse(rawArguments);
    if (typeof held === "object" && held !== null && !Array.isArray(held)) {
      return Object.fromEntries(Object.entries(held));
    }
  } catch {
    // Falls through to the refusal.
  }
  return undefined;
}

/**
 * The link an answered tool call opened, as the field its log line spreads in — none for a refused call or a tool
 * that reads no link. A url-taking read whose link it cannot vouch for writes `null`, so an older link never passes
 * for the newest read: one naming no url, and a delegated one until the plan thread took its answer.
 *
 * @param name the tool the model called
 * @param rawArguments its arguments, as the model wrote them
 * @param refused whether the call was refused or its answer never reached the model
 * @param delegated whether its answer still has to reach the plan thread
 * @returns `{ opened }`, or an empty object
 */
export function openedFieldOf({
  name,
  rawArguments,
  refused,
  delegated,
}: {
  name: string;
  rawArguments: string;
  refused: boolean;
  delegated: boolean;
}): { readonly opened?: string | null } {
  if (refused || !readsLink({ name })) {
    return {};
  }
  const opened = openedLinkOf({ args: argsOf({ rawArguments }), name });
  if (delegated || opened === undefined) {
    return { opened: null };
  }
  return { opened };
}

/**
 * The tray's line for an answered call: what it came to, the link it opened (`openedFieldOf`), and its input and the
 * output the model was handed behind the fold (`toolCallShownOf`), the way a fleet card shows a tool call.
 *
 * @param detail what the call came to, in the words its line shows
 * @param ms the round trip
 * @param output what the model was handed: the answer's text, or the image list a screen read sends
 * @param delegated whether its answer still has to reach the plan thread
 * @returns the line
 */
export function answeredLine({
  delegated,
  detail,
  ms,
  name,
  output,
  rawArguments,
  refused,
}: {
  delegated: boolean;
  detail: string;
  ms: number;
  name: string;
  output: string | ResponseFunctionCallOutputItemList;
  rawArguments: string;
  refused: boolean;
}): ToolLine {
  const opened = openedFieldOf({ delegated, name, rawArguments, refused });
  const shown = toolCallShownOf({ output, rawArguments });
  return { detail, ms, name, refused, shown, usage: undefined, ...opened };
}

/**
 * The line a delegated call writes once its answer's post to the plan thread settled: why the answer was lost, or —
 * for a read that opened a link — that the plan thread took it, naming the link. A delegated read names its link only
 * here: one noted before the post could not be taken back by a call that ended mid-post, nor by an answer the post
 * lost.
 *
 * @param name the tool the plan thread called
 * @param rawArguments its arguments, as the model wrote them
 * @param refused whether the call was refused
 * @param why why the post did not land, or `undefined` when the plan thread took it
 * @returns the line, or `undefined` when the answer landed and opened no link
 */
export function planAnswerLine({
  name,
  rawArguments,
  refused,
  why,
}: {
  name: string;
  rawArguments: string;
  refused: boolean;
  why: string | undefined;
}): ToolLine | undefined {
  if (why !== undefined) {
    return { detail: why, ms: undefined, name, refused: true, usage: undefined };
  }
  const opened = openedFieldOf({ delegated: false, name, rawArguments, refused }).opened;
  if (opened == null) {
    return undefined;
  }
  return { detail: "the plan thread took the answer", ms: undefined, name, opened, refused: false, usage: undefined };
}

/** The longest an answered call's log line runs: a query or a path, never the answer itself. */
export const TOOL_DETAIL_MAX = 600;

/**
 * What an answered read looked at, in the words its log line shows: the verb it ran, the text it searched for, the
 * path it read. A bare "read" leaves the owner unsure whether it is something the voice just read or something it was
 * doing. A verb's own arguments are left out, since only its noun and verb say which command ran.
 *
 * @param name the tool the model called
 * @param args the model's arguments, already checked by the route that answered
 * @returns the line, cut to {@link TOOL_DETAIL_MAX} characters
 */
export function verbToolDetail({ name, args }: { name: string; args: Readonly<Record<string, unknown>> }): string {
  return cutTo({ max: TOOL_DETAIL_MAX, text: detailOf({ args, name }) });
}

/**
 * {@link verbToolDetail}'s line before the cut.
 *
 * @param name the tool the model called
 * @param args the model's arguments
 * @returns the uncut line
 */
function detailOf({ name, args }: { name: string; args: Readonly<Record<string, unknown>> }): string {
  const from =
    typeof args["from"] === "number" || typeof args["from"] === "string" ? ` from ${String(args["from"])}` : "";
  if (name === "verb") {
    const request = args["request"];
    if (isBag(request) && typeof request["noun"] === "string" && typeof request["verb"] === "string") {
      return `read slopweaver ${request["noun"]} ${request["verb"]}`;
    }
  }
  if (name === "code_find" && typeof args["text"] === "string") {
    return `searched tracked files for "${args["text"]}"`;
  }
  if ((name === "code_read" || name === "file_read") && typeof args["path"] === "string") {
    return `read ${args["path"]}${from}`;
  }
  if (name === "code_list") {
    if (typeof args["dir"] === "string") {
      return `listed tracked files under ${args["dir"]}`;
    }
    return "listed tracked files";
  }
  return `read with ${name}`;
}

/**
 * A line no longer than `max` characters, its cut marked with an ellipsis.
 *
 * @param text the line
 * @param max the most characters it may run to, the ellipsis included
 * @returns the line, cut when over
 */
function cutTo({ text, max }: { text: string; max: number }): string {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return text;
  }
  return `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * Run one verb tool through `/api/talk/tool/<name>`.
 *
 * @param name the tool, already resolved to a verb row
 * @param args the model's arguments
 * @returns what to hand back, and one line for the log
 */
export async function runVerbTool({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}): Promise<{ answer: unknown; detail: string; refused: boolean }> {
  try {
    const response = await fetch(`/api/talk/tool/${name}`, {
      body: JSON.stringify(args),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    const result: Bag = isBag(body) ? body : {};
    if (result["ok"] === true) {
      return { answer: result["payload"], detail: verbToolDetail({ args, name }), refused: false };
    }
    const why = str({ bag: result, key: "refused" });
    if (why !== undefined) {
      return { answer: { refused: why }, detail: why, refused: true };
    }
    const broke = str({ bag: result, key: "error" });
    if (broke !== undefined) {
      return { answer: { refused: broke }, detail: broke, refused: true };
    }
    return {
      answer: { refused: `/api/talk/tool/${name} answered something that is not a tool result` },
      detail: "the tool route answered an unknown shape",
      refused: true,
    };
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { answer: { refused: why }, detail: why, refused: true };
  }
}

/**
 * Post one relay to `/api/talk/relay` and read what the verb came to. A throw — the route down, a body that is
 * not JSON — is an `unknown` outcome carrying the reason, never a rejection.
 *
 * @param wire the relay request, already gated
 * @param instance `e2e` when the desktop test instance runs the call: the relay is marked, so the route refuses it
 * @returns the outcome, the line to show, the delivery report, whether a refusal may be retried with the owner's words
 *   alone (`site/lib/relayRetry.ts`), and — only when the row never reached the supervisor's chat — the outcome
 *   the transcript shows instead
 */
export async function postRelay({ wire, instance }: { wire: TalkRelayWire; instance: "e2e" | undefined }): Promise<{
  detail: string;
  outcome: RelayLine["outcome"];
  report: RelayReport;
  shownOutcome: RelayLine["outcome"] | undefined;
  wordsAloneRetry: boolean;
}> {
  let wordsAloneRetry = false;
  let outcome: RelayLine["outcome"] = "unknown";
  let detail = "no answer";
  let report: RelayReport = {
    candidateRuling: undefined,
    deliveryDetail: undefined,
    deliveryKind: undefined,
    ruling: undefined,
    slug: undefined,
  };
  let shownOutcome: RelayLine["outcome"] | undefined;
  try {
    const response = await fetch("/api/talk/relay", {
      body: JSON.stringify(relayWireForInstance({ instance, wire })),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    const result: Bag = isBag(body) ? body : {};
    if (result["outcome"] === "done") {
      outcome = "relayed";
      report = relayReportOf({ out: said({ value: str({ bag: result, key: "out" }), whenAbsent: "" }) });
      const answered = relayedLine({ report });
      detail = answered.detail;
      if (!answered.reachedChat) {
        shownOutcome = "board-only";
      }
    } else if (result["outcome"] === "refused") {
      outcome = "refused";
      detail = said({ value: str({ bag: result, key: "why" }), whenAbsent: "refused without a reason" });
      wordsAloneRetry = result["wordsAloneRetry"] === true;
    } else {
      detail = said({ value: str({ bag: result, key: "why" }), whenAbsent: "no answer" });
    }
  } catch (cause) {
    detail = cause instanceof Error ? cause.message : String(cause);
  }
  return { detail, outcome, report, shownOutcome, wordsAloneRetry };
}

/**
 * What a route said, or the stand-in shown when the answer carried no sentence — an `if` that returns, since
 * `??` is banned here and oxlint rewrites the ternary back into one.
 *
 * @param whenAbsent what to show instead, always a constant at the call site
 * @returns the sentence to display
 */
export function said({ value, whenAbsent }: { value: string | undefined; whenAbsent: string }): string {
  if (value === undefined) {
    return whenAbsent;
  }
  return value;
}
