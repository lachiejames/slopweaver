/**
 * One verdict over BOTH halves of an offered ask: the shape (`--problem`, `--lean`) and the Slack action.
 *
 * `handover ask` and `handover offer` need the same judgement and must not spell it twice — an ask offering
 * a draft and an offer attached to one already asked are the same card, and two readers of the same flags
 * would eventually disagree about which of them derives the options.
 *
 * **`--options` is REFUSED beside `--action`**, and that is the load-bearing rule here rather than a
 * convenience. The options ARE the destinations (`../../../handover/askActionOptions.ts`), so a caller
 * allowed to author both could record "post it to #delivery" beside a draft addressed somewhere else, and the
 * card would print the owner's choice over the wrong message. Deriving them is the only way the two cannot drift.
 */

import type { AskAction } from "../../../handover/askAction.js";
import { actionOptions } from "../../../handover/askActionOptions.js";
import { parseAskOptions } from "../../../handover/askShape.js";
import { askShapeVerdict, type RecordableShape } from "../../../handover/askShapeGate.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { actionFlag, askActionFlagErrorLines } from "./askActionFlag.js";
import { stringFlag } from "./lifecycleRunCore.js";

/** What a verb should do with the flags it was handed. */
export type AskOfferVerdict =
  /** Recordable. `shape` is absent only on an unshaped ask, which `--action` can never be. */
  | {
      readonly kind: "ok";
      readonly shape: RecordableShape | undefined;
      readonly action: AskAction | undefined;
    }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on one invocation's shape and action together.
 *
 * @param parsed this invocation's flags
 * @param command the verb as the caller typed it, for every refusal line
 * @param required whether an unshaped ask is refused — false for a row where the owner has nothing to pick
 * @param stdin how to read stdin, for the `--action -` spelling
 * @returns what to record, or the lines to print instead
 */
export function askOfferVerdict({
  parsed,
  command,
  required,
  stdin,
}: {
  parsed: ParsedFlags;
  command: string;
  required: boolean;
  stdin: () => string;
}): AskOfferVerdict {
  const read = actionFlag({ command, parsed, stdin });
  if (read.isErr()) {
    return { kind: "refused", lines: askActionFlagErrorLines({ command, error: read.error }) };
  }
  const action = read.value;
  const authored = stringFlag({ name: "options", parsed });
  if (action !== undefined && authored !== undefined) {
    return { kind: "refused", lines: bothAuthored({ command }) };
  }
  const parsedOptions = optionsFor({ action, authored });
  const verdict = askShapeVerdict({
    command,
    env: process.env,
    blastRadius: stringFlag({ name: "blast-radius", parsed }),
    lean: stringFlag({ name: "lean", parsed }),
    options: parsedOptions.options,
    parseProblems: parsedOptions.problems,
    problem: stringFlag({ name: "problem", parsed }),
    required,
    risk: stringFlag({ name: "risk", parsed }),
    stillReal: stringFlag({ name: "still-real", parsed }),
  });
  if (verdict.kind === "refused") {
    return verdict;
  }
  return { action, kind: "ok", shape: verdict.shape };
}

/** The options to judge: derived from the action when there is one, parsed off `--options` when there is not. */
function optionsFor({
  action,
  authored,
}: {
  action: AskAction | undefined;
  authored: string | undefined;
}): ReturnType<typeof parseAskOptions> {
  if (action !== undefined) {
    return { options: actionOptions({ action }), problems: [] };
  }
  if (authored === undefined) {
    return { options: [], problems: [] };
  }
  return parseAskOptions({ text: authored });
}

/** The refusal for a caller who authored options beside an action. */
function bothAuthored({ command }: { command: string }): readonly string[] {
  return [
    `${command} blocked because it was given --options AND --action, and the options of an offered ask ` +
      "are its destinations — authoring both is how a card comes to print one choice over a different draft.",
    "Drop --options: one is derived per destination, in order, with HOLD last.",
    "NOTHING was recorded and the run is not paused, so drop the flag and run the same command again.",
  ];
}
