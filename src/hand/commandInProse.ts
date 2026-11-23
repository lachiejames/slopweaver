/**
 * A command only the owner's hands run goes in `literal`, never in a hand step's prose — a POSTING rule, for
 * `./step.ts`'s `linkAsLiteral` reason.
 *
 * Commands are hard to find when a step carries its console as `url` and its commands at the tail of `unblocks` —
 * "…then secrets set google-secops-client-id and -secret" — where the note draws a footer line and the queue card a
 * row of text. `literal` is the step's field for what the owner runs: the note puts
 * it on the owner's pasteboard and the queue card draws it as a copy block (`site/lib/handCard.ts`), beside a `url` when the
 * step has both. So `what`, `where` and `unblocks` may not name a command {@link OWNER_HANDS_COMMANDS} lists.
 *
 * **The criterion.** A window of each field's words (`./proseFields.ts`, case kept) matching a register row, as written
 * or behind an implied `slopweaver` — the bare "secrets set <name>" the SecOps step wrote. A row matching on one word
 * (`sudo`, `op`) counts only when set as a command, and an implied `secrets set` only before a secret-shaped name. A prose
 * mention of a row the literal itself runs is the copy block's explanation, not a hidden command, and passes: "Sign the
 * op CLI in" above `op signin --account atlas`. `witness` is the fleet's settling command and `details` is a monitor's
 * failure text, so neither is read — a recipe failing with "run `op signin`" must not take the fleet-health card down
 * with it — and nor is a monitor card's `unblocks`, built from a subject's label (`./proseFields.ts`).
 *
 * **Residue, stated.** A tell, not a fence: a command outside the register named in prose posts, and so does a fleet
 * verb (`slopweaver codex signin`), which is the fleet's to run rather than the owner's to copy — a different defect.
 *
 * MEASURED over 233 steps posted: 5 are refused — the SecOps step (only through the implied
 * `slopweaver`), three plan sign-ins naming `claude login` with no literal, and a `codex login` in a `where` — and the
 * two 1Password steps whose prose names the `op` their literal runs pass. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then `commandInProse`.
 */
import { checklistCommands } from "./checklist.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import { opensCodeSpan, posterProse, proseTokens, secretNameIn } from "./proseFields.js";
import { literalSegmentWords, type OwnerHandsCommand, ownerHandsCommand } from "./runnableLiteral.js";
import type { HandStep } from "./step.js";

/**
 * How many words one window holds — room for the longest row a sentence spells, `gcloud --project <id> auth login`
 * or `slopweaver slack send … --approve`, and no more, so two unrelated words a paragraph apart are not one command.
 */
const WINDOW = 8;

/** A command-line flag — `-k`, `--account` — never a lone dash standing in for a pause. */
const FLAG = /^--?[a-z]/;

/**
 * How far past a one-word row a flag may sit and still set it as a command: "op signin --account" and "sudo launchctl
 * kickstart -k".
 */
const FLAG_REACH = 3;

/** How many of a matched window's words the refusal quotes. */
const QUOTED_WORDS = 4;

/**
 * The register row a window of prose words runs, read as written and behind an implied `slopweaver`.
 *
 * Two of the rows match on one word — `sudo`, `op` — which English uses as words ("the op CLI signs in", "never runs
 * sudo"), so in prose those count only when set as a command: a code span running past the word, an imperative "run"
 * before it, or a flag within {@link FLAG_REACH} words after it — "Run op signin", "op signin --account atlas". And an
 * implied `slopweaver secrets set` counts only before a secret-shaped name, `./secretName.ts`'s criterion, so "the
 * secrets set up last week" is English here too.
 *
 * @param window the words from one position on
 * @param spanned whether the window's first word opens a code span running past it
 * @param imperative whether the word before the window is "run"
 * @returns the row, or `undefined`
 */
function windowCommand({
  window,
  spanned,
  imperative,
}: {
  window: readonly string[];
  spanned: boolean;
  imperative: boolean;
}): OwnerHandsCommand | undefined {
  const written = ownerHandsCommand({ words: window });
  if (written !== undefined) {
    const oneWord = written.matches({ words: window.slice(0, 1) });
    const flagged = window.slice(1, FLAG_REACH + 1).some((word) => FLAG.test(word));
    return oneWord && !spanned && !imperative && !flagged ? undefined : written;
  }
  if (window[0] === "slopweaver") {
    return undefined;
  }
  const implied = ownerHandsCommand({ words: ["slopweaver", ...window] });
  const name = window[2];
  const shaped = name !== undefined && secretNameIn({ word: name }) !== undefined;
  return implied?.id === "secrets-set" && !spanned && !shaped ? undefined : implied;
}

/**
 * The first command of the owner's a prose field names that the literal does not already run, with the words that named it.
 *
 * @param text the field
 * @param carried the register rows the step's literal runs
 * @returns the row's id and the quoted words, or `undefined`
 */
export function proseCommand({
  text,
  carried,
}: {
  text: string;
  carried: ReadonlySet<string>;
}): { id: string; phrase: string } | undefined {
  const tokens = proseTokens({ text });
  const words = tokens.map((token) => token.word);
  for (const [index, token] of tokens.entries()) {
    const window = words.slice(index, index + WINDOW);
    const imperative = words[index - 1]?.toLowerCase() === "run";
    const row = windowCommand({ imperative, spanned: opensCodeSpan({ token }), window });
    if (row !== undefined && !carried.has(row.id)) {
      return { id: row.id, phrase: window.slice(0, QUOTED_WORDS).join(" ") };
    }
  }
  return undefined;
}

/**
 * The register rows a step's copy blocks run, by id — its literal's, and every checklist line's command's.
 *
 * @param step the step a caller is about to record
 * @returns each row id their segments run
 */
function carriedRows({ step }: { step: HandStep }): ReadonlySet<string> {
  const pastes = [
    ...(step.literal === undefined ? [] : [step.literal]),
    ...checklistCommands({ checklist: step.checklist }),
  ];
  const ids = pastes.flatMap((literal) =>
    literalSegmentWords({ literal }).flatMap((words) => {
      const row = ownerHandsCommand({ words });
      return row === undefined ? [] : [row.id];
    }),
  );
  return new Set(ids);
}

/**
 * The refusal for a step whose prose names a command only the owner's hands run, outside the literal that would let
 * the owner copy it.
 *
 * @param step the step a caller is about to record
 * @returns the refusal naming the field and the words, or `undefined` when every command of the owner's is in `literal`
 */
export function commandInProse({ step }: { step: HandStep }): HandStepError | undefined {
  const carried = carriedRows({ step });
  for (const { field, text } of posterProse({ step })) {
    const found = proseCommand({ carried, text });
    if (found !== undefined) {
      return HandStepErrors.invalidField({
        field,
        why:
          `names a command only the owner's hands run (\`${found.phrase}\`) inside its prose, where neither the note nor the ` +
          "queue card offers it to copy — pass the whole command as --literal, with --where naming the terminal: the " +
          "note puts it on the owner's pasteboard and the queue card draws it as a copy block. A step " +
          "with more than one command: post a --checklist, one command per line, each its own copy block the owner runs one " +
          "at a time (the commands that are the owner's: OWNER_HANDS_COMMANDS, src/hand/runnableLiteral.ts)",
      });
    }
  }
  return undefined;
}
