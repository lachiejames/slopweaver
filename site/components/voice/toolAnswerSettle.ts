/**
 * The end of one answered tool call: its row, its answer handed to the plan thread, and that answer kept on the call
 * file — in that order. Each call keeps every tool's answer, the exact text the model was handed, so a wrong spoken
 * answer can be traced to what it read; and keeping it never sits on the answer's path. So the answer is delivered FIRST and journalled only once delivery settled, by an unawaited append, onto the
 * call the tool BEGAN on — a hang-up while it was delivered still lands it there (`../../lib/transcriptSink.ts`).
 *
 * The row drawn is `answeredLine`'s, with the input and output the session tray folds (`shown`); the file keeps the
 * exact answer instead, since `shown` re-indents JSON. Split from `./VoiceProvider.tsx`, which sits at its
 * 300-line cap, and plain so the order is a unit test.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import type { MessengerReadSubject } from "../../lib/messengerBand";
import { callFileToolAnswerOf } from "../live/talkSession";
import { answeredLine, planAnswerLine } from "./talkToolCalls";
import type { ToolLine } from "./voiceContext";

/** What a tool's answer is handed over with, besides what the call it answers already says. */
interface Delivered<Held> {
  readonly held: Held;
  readonly output: string | ResponseFunctionCallOutputItemList;
  readonly refused: boolean;
  readonly tool: string;
}

/**
 * Settle one answered tool call. With no plan call nothing was handed to a model, so the row is drawn and journalled
 * on the call now running with no answer; otherwise the answer is delivered, and only then is the row drawn — when
 * this session is still the one running — and journalled with its answer on the call the tool began on, followed by
 * the line saying how the delivery went.
 *
 * @param call the call the tool began on, read before it ran; `undefined` when it began on none
 * @param plan the plan call to hand the answer to, or `undefined` when there is none
 * @param deliver hands the answer to the plan call (`./planWiringHeld.ts`'s `deliverPlanAnswer` unless a test passes a seam)
 * @param delivery what the answer is handed over with besides the call, its output, refusal and tool name
 * @param output exactly what the model is handed
 * @param tool the answered call: its name, arguments, log detail, refusal, how long it ran and the turn that called it
 * @param live whether this session is still the one running, asked after the delivery
 * @param note draws a row and journals it on the call running now
 * @param settle draws the answered row when `drawn`, and journals it with `answer` on `call`
 * @returns why the plan call did not take the answer, `undefined` when it did or there was none to hand it to
 */
export async function settleToolAnswer<Held, Delivery>({
  call,
  plan,
  deliver,
  delivery,
  output,
  tool,
  live,
  note,
  settle,
}: {
  call: string | undefined;
  plan: Held | undefined;
  deliver: (input: Delivery & Delivered<Held>) => Promise<string | undefined>;
  delivery: Delivery;
  output: string | ResponseFunctionCallOutputItemList;
  tool: {
    name: string;
    rawArguments: string;
    detail: string;
    refused: boolean;
    ms: number;
    turnId: string | undefined;
    knowledge: MessengerReadSubject | undefined;
  };
  live: () => boolean;
  note: (input: { line: ToolLine }) => void;
  settle: (input: {
    call: string | undefined;
    line: ToolLine;
    answer: string;
    drawn: boolean;
    turnId: string | undefined;
  }) => void;
}): Promise<string | undefined> {
  const { detail, knowledge, ms, name, rawArguments, refused, turnId } = tool;
  const answered = answeredLine({ delegated: plan !== undefined, detail, ms, name, output, rawArguments, refused });
  // What the messenger band may claim; the call file names its own fields and takes none of this (`transcriptToolLine`).
  const line = knowledge === undefined ? answered : { ...answered, knowledge };
  if (plan === undefined) {
    note({ line });
    return undefined;
  }
  // The post to the call file is the sink's, unawaited; a lost delivery keeps the payload it attempted, beside the
  // line below that says it was lost, never a claim the model certainly read it.
  const why = await deliver({ ...delivery, held: plan, output, refused, tool: name });
  const drawn = live();
  settle({ answer: callFileToolAnswerOf({ output }), call, drawn, line, turnId });
  const settled = planAnswerLine({ name, rawArguments, refused, why });
  if (settled !== undefined && drawn) {
    note({ line: settled });
  }
  return why;
}
