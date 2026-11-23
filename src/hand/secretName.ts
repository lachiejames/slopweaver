/**
 * A hand step never tells the owner to store a secret under a name the shipped registry lacks — a POSTING rule, for
 * `./step.ts`'s `linkAsLiteral` reason.
 *
 * The failure it closes: a step told the owner to `secrets set google-secops-client-id` and `-secret`, and
 * `slopweaver secrets set google-secops-client-id` answered "unknown secret name" because the rows lived on a branch
 * that had not landed. The owner did the console half of the step and then met a verb that did not exist yet, with
 * commands that were hard to find and wrong. So a step naming `secrets set <name>` — in its `literal`, or in
 * the prose its poster wrote (`./proseFields.ts`) — is refused while `src/secrets/registry.ts` has no row for that name, and refused
 * with that row's own `writtenBy` when the row exists and `secrets set` refuses it (a grant, a hand-installed file, a
 * retired name). `hand post` names the branch that adds a missing row (`../devLint/secretsRegistryGit.ts`).
 *
 * **The criterion.** In a `literal`, a segment that runs `slopweaver secrets set <name>`, read by the same segment walk
 * `./runnableLiteral.ts` uses. In prose, `secrets set` followed by a word shaped like a secret's name — lowercase parts
 * joined by `-`, `.` or `_`, which every registry row is (`./proseFields.ts`) — so "the secrets set up last week" is
 * English, behind a `slopweaver` or not.
 *
 * **Residue, stated.** The registry read is the POSTER's checkout, while `slopweaver` in the owner's terminal resolves
 * to the checkout they stand in, else the main one: a chair posting from a worktree on the branch that adds the row
 * passes while the owner's paste from the main checkout would still be refused. And a name spelt only by its suffix
 * ("and -secret") is no name, so it is not checked.
 *
 * MEASURED over the 233 steps posted at the time: 3 literals name a name the registry then lacked or refused —
 * the KnowBe4 and HiBob tokens, rows since removed, and the OpenAI key, since retired — each registered and settable
 * when posted; the SecOps step is the fourth, by its prose. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then
 * `secretNameRefusal`.
 */
import { credentialsByName } from "../secrets/registry.js";

import { checklistCommands } from "./checklist.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import { isPlaceholder, posterProse, proseTokens, secretNameIn } from "./proseFields.js";
import { literalSegmentWords } from "./runnableLiteral.js";
import type { HandStep } from "./step.js";

/**
 * Every name a prose field has the owner store with `secrets set` — only a secret-shaped word, so never a flag, a `<name>`
 * placeholder, or the English after a mention: "paste it into slopweaver secrets set when it prompts" (Claude r2).
 *
 * @param text the field
 * @returns each name, in order
 */
function proseSecretNames({ text }: { text: string }): readonly string[] {
  const tokens = proseTokens({ text });
  const names: string[] = [];
  tokens.forEach((token, index) => {
    const name = tokens[index + 2];
    if (token.word !== "secrets" || tokens[index + 1]?.word !== "set" || name === undefined) {
      return;
    }
    if (name.word.startsWith("-") || isPlaceholder({ token: name })) {
      return;
    }
    const named = secretNameIn({ word: name.word });
    if (named !== undefined) {
      names.push(named);
    }
  });
  return names;
}

/**
 * Every name a literal's segments store with `slopweaver secrets set` — the verb reads its name as the first word
 * after `set`, so a flag there is no name.
 *
 * @param literal the paste
 * @returns each name, in order
 */
function literalSecretNames({ literal }: { literal: string }): readonly string[] {
  return literalSegmentWords({ literal }).flatMap((words) => {
    const name = words[3];
    const stores = words[0] === "slopweaver" && words[1] === "secrets" && words[2] === "set";
    return stores && name !== undefined && !name.startsWith("-") ? [name] : [];
  });
}

/**
 * Every name the step has the owner store with `secrets set`, the literal's first, each once.
 *
 * @param step the step a caller is about to record
 * @returns each distinct name, in the order the step names them
 */
export function secretsSetNames({ step }: { step: HandStep }): readonly string[] {
  const pastes = [
    ...(step.literal === undefined ? [] : [step.literal]),
    ...checklistCommands({ checklist: step.checklist }),
  ];
  const named = [
    ...pastes.flatMap((literal) => literalSecretNames({ literal })),
    ...posterProse({ step }).flatMap(({ text }) => proseSecretNames({ text })),
  ];
  return [...new Set(named)];
}

/**
 * The names the console draws a secure paste field for on this step's card — every name it stores that `secrets set`
 * accepts today, so the field never offers a write the verb behind it would refuse.
 *
 * The secret gets pasted into the console rather than typed at a terminal. `hand post` already refused an
 * unregistered or unsettable name when the step was posted; this re-reads the registry at list time, because a row
 * retired since then must not leave a field behind that answers "unknown secret name".
 *
 * @param step an open step
 * @returns the settable names, in the order the step names them
 */
export function pasteableSecrets({ step }: { step: HandStep }): readonly string[] {
  const registry = credentialsByName();
  return secretsSetNames({ step }).filter((name) => registry.get(name)?.settable === true);
}

/** The base branches a declaring ref may be — the poster's checkout is behind them, not waiting on a branch to land. */
const BASE_REFS: ReadonlySet<string> = new Set(["refs/heads/main", "refs/remotes/origin/main"]);

/** How many declaring refs one line names before it counts the rest. */
const NAMED_REFS = 2;

/**
 * The line `hand post` prints beside an unregistered name: which branch to land, that main already has it, or that
 * no branch was found — never that none declares it, since the lookup's pickaxe can miss one.
 *
 * @param name the name the registry lacks
 * @param refs the full ref names whose register tip declares it (`unlandedBranchesDeclaring`)
 * @returns the line
 */
export function declaringBranchLine({ name, refs }: { name: string; refs: readonly string[] }): string {
  if (refs.length === 0) {
    return `${name}: no branch found declaring it — its row has to be written and landed before any step names it`;
  }
  if (refs.some((ref) => BASE_REFS.has(ref))) {
    return `${name}: main already declares it — pull this checkout and the main checkout, then post the step`;
  }
  const named = refs.slice(0, NAMED_REFS).join(", ");
  const more = refs.length > NAMED_REFS ? ` (and ${String(refs.length - NAMED_REFS)} more carrying it)` : "";
  return `${name}: declared on ${named}${more} — land that branch first, then pull the main checkout and post the step`;
}

/**
 * The refusal for a step that has the owner store a secret the registry cannot take — every name it lacks, else the first
 * row `secrets set` refuses.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when every name it stores is a settable row
 */
export function secretNameRefusal({ step }: { step: HandStep }): HandStepError | undefined {
  const registry = credentialsByName();
  const names = secretsSetNames({ step });
  const unregistered = names.filter((name) => !registry.has(name));
  if (unregistered.length > 0) {
    return HandStepErrors.secretNameUnregistered({ names: unregistered });
  }
  const unsettable = names.map((name) => registry.get(name)!).find((spec) => !spec.settable);
  if (unsettable === undefined) {
    return undefined;
  }
  return HandStepErrors.secretNameUnsettable({
    name: unsettable.name,
    retired: unsettable.lifecycle === "retired",
    writtenBy: unsettable.writtenBy,
  });
}
