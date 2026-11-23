/**
 * The two measurements the Datadog atlas's hand-written tables were built from, as a command that can be
 * run again.
 *
 * ```bash
 * yarn tsx tools/datadogOperationScan.ts --secrets   # which operations' responses reach a secret-shaped field
 * yarn tsx tools/datadogOperationScan.ts --actions   # which GET operations describe themselves as ACTING
 * ```
 *
 * ## Why this is a committed tool rather than a number in a comment
 *
 * `.claude/rules/typescript-patterns.md`: a comment citing a measurement carries the command that
 * reproduces it. `sensitiveFields.ts` and `exclusions.ts` both rest on a scan of the installed SDK, and
 * without this file those citations would be prose nobody could check — which is the exact rot the rule
 * exists to prevent. The sibling JumpCloud atlas cites a verb that does not exist; this is that mistake not
 * repeated.
 *
 * ## What each scan is, and is NOT
 *
 * `--secrets` resolves every operation's declared response type through its models, four levels deep, and
 * reports any field whose NAME is secret-shaped. It is how the denial table was BUILT and it is not a proof
 * that the table is complete: the keyword set is a pattern, the depth is bounded, and a field Datadog adds
 * next month is in neither. `sensitivity.ts` is the layer that assumes exactly that.
 *
 * It follows a UNION TYPE ALIAS, and that line is why. The first version of this scan resolved a declared
 * type by looking for a model file with fields, so `SyntheticsBasicAuth` — a file that declares only
 * `A | B | C` and no fields of its own — resolved to nothing, and every field of its seven variants was
 * invisible. An adversarial review pass found `SyntheticsBasicAuthSigv4.secretKey` behind exactly that
 * blind spot: an AWS SigV4 secret on an admitted synthetics test. The instrument being incomplete is a
 * worse defect than a missing table row, because it makes the table look complete.
 *
 * `--actions` reads each GET operation's own JSDoc description — the specification's prose, carried into
 * the client — and reports any that reads like an action. Most hits are false: a description of notification
 * CONFIGURATION mentions notifying. The one that was not false is `GET /api/v1/graph/snapshot`, which
 * renders a widget and uploads the image, and it is why this atlas refuses an operation for what it DOES
 * rather than for its method.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SDK_ROOT = "node_modules/@datadog/datadog-api-client/dist/packages";
const SPECS = ["v1", "v2"] as const;

/**
 * Field names that look like credential material, whatever they turn out to be.
 *
 * Deliberately WIDE — the point of the scan is to surface candidates for a human decision, and the JumpCloud
 * measurement that motivated the whole named-denial design was that most such names are posture. Narrowing
 * this would hide the very false positives that make the case.
 */
const SECRET_SHAPED =
  /(secret|password|passphrase|credential|privatekey|apikey|token|^key$|^keys$|^hash$|accesskey|sharedkey|sessionkey|clientkey|signingkey|encryptionkey|certificate|publicportion|last4)/i;

/**
 * Description words that suggest an operation ACTS rather than observes. Wide, for the same reason.
 *
 * The creation words are here because they were MISSING: the first version looked only for send-and-trigger
 * language, and `GET /api/v2/cost/tag_descriptions/{tag_key}/generate` — which invokes Datadog's own AI to
 * write a draft description — went straight past it into an admitted row. A scan whose vocabulary is too
 * narrow reports clean over exactly the operations it cannot name.
 */
const ACTION_SHAPED =
  /\b(trigger|triggers|send|sends|sending|reach(es)? out|invoke|execute|reprocess|upload|generate|generates|create|creates|render|renders|capture|captures|produce|produces|draft|drafts)/i;

/** Where one package's compiled and declared API modules live. */
function apisDirectory({ spec }: { spec: (typeof SPECS)[number] }): string {
  return join(SDK_ROOT, `datadog-api-client-${spec}`, "apis");
}

/** Every declared field on every model in one package, keyed `<spec>/<Model>`. */
function modelFields({
  spec,
}: {
  spec: (typeof SPECS)[number];
}): ReadonlyMap<string, readonly { name: string; type: string }[]> {
  const directory = join(SDK_ROOT, `datadog-api-client-${spec}`, "models");
  const models = new Map<string, readonly { name: string; type: string }[]>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".d.ts"))) {
    const text = readFileSync(join(directory, file), "utf8");
    models.set(
      `${spec}/${file.replace(".d.ts", "")}`,
      [...text.matchAll(/^\s{4}"([A-Za-z_][A-Za-z0-9_]*)"\??:\s*([^;]+);/gm)].map((match) => ({
        name: match[1]!,
        type: match[2]!.trim(),
      })),
    );
  }
  return models;
}

/** Strip `Array<>` and split an inline union so a declared type resolves to model names. */
function candidateModels({ type }: { type: string }): readonly string[] {
  return type
    .replace(/^Array<(.+)>$/, "$1")
    .split("|")
    .map((part) => part.trim());
}

/**
 * Every model a type alias file expands to, for a file that declares a union and no fields of its own.
 *
 * `SyntheticsBasicAuth` is the case that motivated this: seven variants, no fields, and a resolver that
 * only followed fields saw nothing at all beneath it.
 *
 * @param spec which package the alias belongs to
 * @param name the alias's own model name
 * @returns the variant model names, or an empty list when it is not a union alias
 */
function aliasVariants({ spec, name }: { spec: (typeof SPECS)[number]; name: string }): readonly string[] {
  const file = join(SDK_ROOT, `datadog-api-client-${spec}`, "models", `${name}.d.ts`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const declared = /export declare type [A-Za-z0-9_]+ =\s*([^;]+);/.exec(text);
  return declared === null ? [] : candidateModels({ type: declared[1]!.replace(/\s+/g, " ") });
}

/**
 * Walk one declared response type, reporting every secret-shaped field path beneath it.
 *
 * @param spec which package the type belongs to
 * @param type the declared type, as the API class spells it
 * @param models every model in that package
 * @returns one line per secret-shaped position found, bounded to four levels
 */
function secretPaths({
  spec,
  type,
  models,
}: {
  spec: (typeof SPECS)[number];
  type: string;
  models: ReadonlyMap<string, readonly { name: string; type: string }[]>;
}): readonly string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const descend = ({ current, path, depth }: { current: string; path: string; depth: number }): void => {
    if (depth > 4) {
      return;
    }
    const direct = candidateModels({ type: current });
    const expanded = direct.flatMap((candidate) => [candidate, ...aliasVariants({ name: candidate, spec })]);
    for (const candidate of expanded) {
      const modelKey = `${spec}/${candidate}`;
      const fields = models.get(modelKey);
      if (fields === undefined || fields.length === 0 || seen.has(modelKey)) {
        continue;
      }
      seen.add(modelKey);
      for (const field of fields) {
        if (field.name === "additionalProperties" || field.name === "_unparsed") {
          continue;
        }
        const here = `${path}.${field.name}`;
        if (SECRET_SHAPED.test(field.name)) {
          found.push(`${here}  [${candidate}]`);
        }
        descend({ current: field.type, depth: depth + 1, path: here });
      }
    }
  };
  descend({ current: type, depth: 0, path: "" });
  return found;
}

/** Report every operation whose declared response reaches a secret-shaped field. */
function runSecretScan(): void {
  let operations = 0;
  let hits = 0;
  for (const spec of SPECS) {
    const models = modelFields({ spec });
    const directory = apisDirectory({ spec });
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".d.ts"))) {
      const className = file.replace(".d.ts", "");
      const text = readFileSync(join(directory, file), "utf8");
      const body = text.split(`export declare class ${className} {`)[1] ?? "";
      for (const match of body.matchAll(/^\s{4}([a-zA-Z][A-Za-z0-9]*)\(param[^)]*\)\s*:\s*Promise<([^;]+)>;/gm)) {
        operations += 1;
        const paths = secretPaths({ models, spec, type: match[2]!.trim() });
        if (paths.length > 0) {
          hits += 1;
          process.stdout.write(`\n${spec}.${className}.${match[1]} -> ${match[2]!.trim()}\n`);
          for (const path of paths) {
            process.stdout.write(`   ${path}\n`);
          }
        }
      }
    }
  }
  process.stdout.write(
    `\n${String(hits)} of ${String(operations)} operations reach a secret-shaped field name. Most are POSTURE — that is the finding.\n`,
  );
}

/** Report every operation whose own description reads like an action rather than an observation. */
function runActionScan(): void {
  for (const spec of SPECS) {
    const directory = apisDirectory({ spec });
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".d.ts"))) {
      const className = file.replace(".d.ts", "");
      const text = readFileSync(join(directory, file), "utf8");
      const body = text.split(`export declare class ${className} {`)[1] ?? "";
      for (const match of body.matchAll(/\/\*\*\n((?:\s*\*.*\n)+?)\s*\*\/\n\s{4}([a-zA-Z][A-Za-z0-9]*)\(/g)) {
        const description = match[1]!
          .replace(/^\s*\*\s?/gm, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (ACTION_SHAPED.test(description)) {
          process.stdout.write(`${spec}.${className}.${match[2]}\n    ${description.slice(0, 200)}\n`);
        }
      }
    }
  }
}

if (process.argv.includes("--actions")) {
  runActionScan();
} else if (process.argv.includes("--secrets")) {
  runSecretScan();
} else {
  throw new Error("usage: datadogOperationScan --secrets | --actions");
}
