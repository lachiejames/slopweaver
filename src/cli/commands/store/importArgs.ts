/**
 * The arguments `store import-resolve` and `store import-questions` take, parsed without touching the store.
 * The answer itself is checked against the question's kind by the store port, which knows the kind; here only
 * its presence and the question id's shape are. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { directoryFlag } from "./transferArgs.js";

/** `store import-resolve`'s flags. */
export const STORE_IMPORT_RESOLVE_FLAGS: FlagSpec = { boolean: ["json"], string: ["question", "action", "home"] };

/** `store import-questions`'s flags. */
export const STORE_IMPORT_QUESTIONS_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

/** The shape every staged question id takes. */
const QUESTION_ID = /^import-q-[0-9a-f]{16}$/u;

/** A parsed `store import-resolve`. */
export interface StoreImportResolveArgs {
  readonly question: string;
  readonly action: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `store import-questions`. */
export interface StoreImportQuestionsArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** An optional `--home`: absent, or a non-empty directory, refused exactly as `store import` refuses it. */
function homeFlag({
  values,
  verb,
}: {
  values: Readonly<Record<string, string | boolean>>;
  verb: string;
}): Result<string | undefined> {
  return directoryFlag({ name: "home", required: false, values, verb }).mapErr((error) => [error.message]);
}

/** Every refusal the two required `import-resolve` values earn. */
function resolveRefusals({ values }: { values: Readonly<Record<string, string | boolean>> }): readonly string[] {
  const refusals: string[] = [];
  const question = values["question"];
  if (typeof question !== "string" || !QUESTION_ID.test(question)) {
    refusals.push("store import-resolve: --question needs a staged question id, import-q- and 16 hex");
  }
  const action = values["action"];
  if (typeof action !== "string" || action.trim() === "") {
    refusals.push("store import-resolve: --action needs the answer, one the question lists");
  }
  return refusals;
}

/**
 * Parse `store import-resolve`'s arguments.
 *
 * @param rest the argv after the verb
 * @returns the arguments, or every refusal
 */
export function parseStoreImportResolveArgs({ rest }: { rest: readonly string[] }): Result<StoreImportResolveArgs> {
  return parseFlags({ args: rest, spec: STORE_IMPORT_RESOLVE_FLAGS }).andThen(({ values }) => {
    const home = homeFlag({ values, verb: "import-resolve" });
    const refusals = [...resolveRefusals({ values }), ...(home.isErr() ? home.error : [])];
    if (refusals.length > 0 || home.isErr()) {
      return err(refusals);
    }
    return ok({
      action: String(values["action"]),
      home: home.value,
      json: values["json"] === true,
      question: String(values["question"]),
    });
  });
}

/**
 * Parse `store import-questions`'s arguments.
 *
 * @param rest the argv after the verb
 * @returns the arguments, or every refusal
 */
export function parseStoreImportQuestionsArgs({ rest }: { rest: readonly string[] }): Result<StoreImportQuestionsArgs> {
  return parseFlags({ args: rest, spec: STORE_IMPORT_QUESTIONS_FLAGS }).andThen(({ values }) =>
    homeFlag({ values, verb: "import-questions" }).map((home) => ({ home, json: values["json"] === true })),
  );
}
