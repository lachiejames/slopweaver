/**
 * Which model the supervisor chair is REALLY running on, read from its own transcript rather than from what it
 * was seated with.
 *
 * ## The failure this reads for
 *
 * MEASURED in a transcript (frozen, field-trimmed, as
 * `src/__tests__/fixtures/supervisor/chair-fallback-a0000023.jsonl`): the chair booted on `claude-fable-5-1`, and
 * about 34 minutes later Claude Code wrote a `type: "system"`, `subtype:
 * "model_refusal_fallback"` record — `originalModel` `claude-fable-5-1`, `fallbackModel` `claude-opus-4-8`,
 * `scope` `session`, `apiRefusalCategory` `cyber`. Every one of the 266 assistant records after it carries
 * `message.model` `claude-opus-4-8`, while the session ledger still said the seat booted on Fable. An Opus
 * seat taking on the role of supervisor should be essentially impossible. Nothing re-read the model after seating, so nothing could say so.
 *
 * Repro: `grep -c '"subtype":"model_refusal_fallback"' <transcript>` and
 * `grep -o '"model":"claude-[a-z0-9-]*"' <transcript> | sort | uniq -c`.
 *
 * ## The rule
 *
 * The NEWEST assistant record carrying a model decides. A seat whose newest turn is not Fable is off Fable,
 * whatever it booted on. A fallback record written AFTER the newest Fable turn is off Fable too — the switch
 * happened and nothing has run on Fable since, which is exactly the instant between the fallback firing and the
 * first Opus turn landing. A fallback followed by later Fable turns is on Fable: `/model` restored it, by the
 * owner's hand or by the chair's own (`./chairRestore.ts`).
 *
 * Order is FILE order, never timestamp order — a transcript is append-only, and two records written in the same
 * millisecond are real (the fallback record above shares its second with the tool call before it).
 *
 * The fallback record itself is read by `sessions/modelFallback.ts`, which owns that shape for every reader;
 * this module owns only what being off FABLE means. Pure: text in, verdict out. A tail read starts mid-line, so
 * an unparseable line is skipped rather than fatal.
 */
import { type ModelFallbackRecord, readAssistantModelLine, readModelFallbackLine } from "../sessions/modelFallback.js";

/** The prefix every Fable model id carries — `claude-fable-5-1` today. */
const FABLE_MODEL_PREFIX = "claude-fable";

/**
 * The `/model` argument that puts a seat back on Fable.
 *
 * An ALIAS rather than an id on purpose: `claude-fable-5-1` is today's id and `/model` resolves the family
 * name, so a version bump does not silently start sending an argument Claude Code no longer knows.
 */
export const FABLE_MODEL_ALIAS = "fable";

/** What one chair transcript says about the model its seat is running on. */
export type ChairVerdict =
  /** The newest assistant turn ran on Fable, and no fallback has been written since. */
  | { readonly kind: "on-fable"; readonly model: string; readonly atIso: string }
  /**
   * The seat is not on Fable: its newest turn ran on `model`, or a fallback switched it after that turn.
   * `fallback` is the newest safeguard fallback in what was read, when there is one — the reason, if it was one.
   */
  | {
      readonly kind: "off-fable";
      readonly model: string;
      readonly atIso: string;
      readonly fallback: ModelFallbackRecord | undefined;
    }
  /** No assistant record carrying a model was found, so nothing can be said. */
  | { readonly kind: "unreadable"; readonly why: string };

/** The `timestamp` a transcript line carries, or the empty string. */
function lineTimestamp({ line }: { line: string }): string {
  const match = /"timestamp":"([^"]*)"/.exec(line);
  if (match === null) {
    return "";
  }
  const [, captured] = match;
  if (captured === undefined) {
    return "";
  }
  return captured;
}

/**
 * Judge a chair's transcript text.
 *
 * @param text the transcript, whole or a tail of it
 * @returns which model the seat is on, and the fallback that put it there when one did
 */
export function judgeChairTranscript({ text }: { text: string }): ChairVerdict {
  let newest: { readonly model: string; readonly atIso: string; readonly index: number } | undefined;
  let fallback: (ModelFallbackRecord & { readonly index: number }) | undefined;
  text.split("\n").forEach((line, index) => {
    const model = readAssistantModelLine({ line });
    if (model !== undefined) {
      newest = { atIso: lineTimestamp({ line }), index, model };
      return;
    }
    const record = readModelFallbackLine({ line });
    if (record !== undefined) {
      fallback = { ...record, index };
    }
  });
  if (newest === undefined) {
    return { kind: "unreadable", why: "no assistant record naming a model was found in what was read" };
  }
  let reported: ModelFallbackRecord | undefined;
  if (fallback !== undefined) {
    reported = {
      atIso: fallback.atIso,
      category: fallback.category,
      fallbackModel: fallback.fallbackModel,
      originalModel: fallback.originalModel,
    };
  }
  const onFable = newest.model.startsWith(FABLE_MODEL_PREFIX);
  if (!onFable) {
    return { atIso: newest.atIso, fallback: reported, kind: "off-fable", model: newest.model };
  }
  if (fallback !== undefined && reported !== undefined && fallback.index > newest.index) {
    return { atIso: fallback.atIso, fallback: reported, kind: "off-fable", model: fallback.fallbackModel };
  }
  return { atIso: newest.atIso, kind: "on-fable", model: newest.model };
}
