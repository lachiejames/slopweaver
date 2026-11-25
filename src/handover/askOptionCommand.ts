/**
 * An ask option that is a step only the owner's hands take carries the exact command to copy — and the card form
 * refuses one that does not.
 *
 * ## Why this exists
 *
 * A Queue card asked "Will you sign plan-3 back in?" with option A "sign plan-3 in again", and its `what` said the
 * command would come as a hand step once the owner said yes. The rule that followed: a card never shows such an ask
 * without the command to copy and paste into a terminal. So an option the owner would take at a terminal carries
 * that command as {@link AskOption.command}, the card draws it as a copy block under its own letter, and
 * {@link askOptionsCommandProblems} refuses the option that names such a step and carries none (`AGENTS.md` rule 7:
 * refused, never truncated).
 *
 * **It runs where an ask is WRITTEN, never where one is read.** `./askShapeGate.ts`'s `askShapeVerdict` (the `ask`,
 * `register` and reshape verbs) and `./rowEventSchema.ts` (the journal's write schema) call it; `./askShape.ts`'s
 * `askShapeProblems` does not, because that one also judges rows and hand steps already recorded (`./askRow.ts`,
 * which `register-hygiene` reads, and `../hand/decisionContext.ts`). Inside it, the rule turned every ask recorded
 * before it existed into a malformed row and failed every push's pre-push gate on a row nobody could have written
 * differently at the time.
 *
 * ## The criterion, and its residue
 *
 * Read off the OPTION's own sentence only, never its trade-off: a trade-off describes consequences ("avoids another
 * sign-in") rather than the act. An option needs a command when it reads as a sign-in action ({@link SIGN_IN_ACTION})
 * or names a command from the owner-hands register (`../hand/commandInProse.ts`'s `proseCommand`). A present command
 * is always checked, needed or not: one line, a shell command, at least one segment the owner-hands register lists,
 * and no segment the fleet could run itself (`../hand/runnableLiteral.ts`) — a step the fleet can run is not the
 * owner's to copy.
 *
 * A tell, not a fence: an owner step worded with neither tell ("renew plan-3") records with no command. A false
 * positive is repaired by rewording the option. Deliberately narrower than `../hand/decision.ts`'s `isSignIn`, whose
 * bare `auth` would refuse "auth is fine as is".
 *
 * Pure: no filesystem, no clock. The caller supplies the option.
 */

import { proseCommand } from "../hand/commandInProse.js";
import {
  fleetRunnableSegment,
  isShellCommand,
  literalSegmentWords,
  ownerHandsCommand,
} from "../hand/runnableLiteral.js";

import type { AskOption } from "./askShape.js";

/**
 * A sentence choosing to sign in: "sign in", "log in", "login", "re-login", "sign into", "authenticate", and the split
 * form "sign plan-3 in again" / "sign it back in" with at most three words between. The split form is `sign` only and
 * ends on `in` only, so "sign off on the release" and "log the error in Datadog" are not sign-ins.
 */
const SIGN_IN_ACTION =
  /\b(?:re-?)?(?:sign|log)(?:s|ged|ging|ing)?[-\s]?(?:in|into|on)\b|\bsign(?:s|ing)?\s+(?!off\b|up\b)(?:\S+\s+){1,3}?in\b|\bauthenticat(?:e|ing)\b/i;

/** Where an option's command goes — the card draws it under "in your terminal" (`site/lib/queueCardAsk.ts`). */
const TERMINAL = "your terminal";

/** The last C0 control code unit; DEL (`0x7f`) is the other control a command may not carry. */
const LAST_C0 = 0x1f;

/** DEL, the one control code unit past the C0 range. */
const DEL = 0x7f;

/**
 * Whether a line carries a control code unit — C0 (tab included, which no pasted command needs) or DEL. A code-unit
 * scan rather than a character-class regex, which oxlint's `no-control-regex` refuses.
 *
 * @param text the command
 * @returns true when one is present
 */
function hasControl({ text }: { text: string }): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit <= LAST_C0 || unit === DEL) {
      return true;
    }
  }
  return false;
}

/** The empty set of register rows a carried command already runs — an option's prose has no literal beside it. */
const NONE_CARRIED: ReadonlySet<string> = new Set();

/**
 * Whether an option's sentence names a step only the owner's hands take at a terminal.
 *
 * @param text the option's own sentence, never its trade-off
 * @returns the words that made it one, or `undefined` when it names no such step
 */
function ownerStepPhrase({ text }: { text: string }): string | undefined {
  // The named command first, so "run codex login" is quoted as the command rather than as its word "login".
  const named = proseCommand({ carried: NONE_CARRIED, text });
  if (named !== undefined) {
    return named.phrase;
  }
  return SIGN_IN_ACTION.exec(text)?.[0];
}

/**
 * Every way one present command would not be a line the owner can paste into a terminal.
 *
 * @param letter the option's letter, as the refusal names it
 * @param command the command the option carries
 * @returns one sentence per rule broken, empty when it is the owner's command
 */
function commandProblems({ letter, command }: { letter: string; command: string }): readonly string[] {
  const label = `option ${letter}'s command`;
  if (command.trim().length === 0) {
    return [`${label} is empty — write the exact line the owner pastes, or drop the third \`::\``];
  }
  if (/[\r\n]/u.test(command)) {
    return [`${label} runs over more than one line — the copy block pastes one line into the owner's terminal`];
  }
  // Any other control byte too: a registered ask writes the command into strict-YAML front matter, which refuses one
  // and drops every option with it (the r2 counterexample: a vertical tab), and no pasted command needs one.
  if (hasControl({ text: command })) {
    return [`${label} carries a control character — write the line as the owner would type it`];
  }
  if (!isShellCommand({ literal: command, where: TERMINAL })) {
    return [`${label} "${command}" is not a shell command — it is what the owner pastes into a terminal`];
  }
  const owners = literalSegmentWords({ literal: command }).some((words) => ownerHandsCommand({ words }) !== undefined);
  if (!owners) {
    return [
      `${label} "${command}" runs nothing only the owner's hands can — a sign-in, a secret or an approval — so the ` +
        "fleet runs it and the option is not the owner's step",
    ];
  }
  const fleet = fleetRunnableSegment({ literal: command });
  if (fleet !== undefined) {
    return [`${label} carries "${fleet}", which the fleet can run itself — leave only the owner's own segment`];
  }
  return [];
}

/**
 * Every way one ask option breaks the command rule, empty when it is well-formed.
 *
 * @param option the option a verb is about to record
 * @returns one sentence per rule broken
 */
export function askOptionCommandProblems({ option }: { option: AskOption }): readonly string[] {
  if (option.command !== undefined) {
    return commandProblems({ command: option.command, letter: option.letter });
  }
  const phrase = ownerStepPhrase({ text: option.option });
  if (phrase === undefined) {
    return [];
  }
  return [
    `option ${option.letter} is a step only the owner's hands take ("${phrase}") but carries no command — the owner ` +
      `is never shown a hand step without the command to copy; add \`:: <command>\` to option ${option.letter}'s ` +
      "line as a third part, or reword it if it is not the owner's step",
  ];
}

/**
 * Every way a set of options about to be WRITTEN breaks the command rule, in option order.
 *
 * @param options the options a verb or a journal write is about to record
 * @returns one sentence per rule broken, empty when every option is well-formed
 */
export function askOptionsCommandProblems({ options }: { options: readonly AskOption[] }): readonly string[] {
  return options.flatMap((option) => askOptionCommandProblems({ option }));
}
