/**
 * The source-shape gates' refusal copy — the part of the declaration table that belongs to the instruments
 * judging the structure of TypeScript source and the text it is written in.
 *
 * A gate lives here when what it reads is the shape of a declaration, an expression, a regular expression, a
 * string or a byte: complexity, parameters, results and fallbacks, documentation tags, and the whole-payload
 * and spread patterns. A gate that judges what code REACHES (a process, a provider, a channel, a root) is in
 * `./reachDeclarations.ts`, and one that judges a statement the repository makes about itself is in
 * `./claimDeclarations.ts`.
 *
 * Every refusal id of a gate lives in the same leaf — a gate's fresh-violation row and its debt or rebaseline
 * row move together — which `registryComposition.test.ts` holds down. A new row goes here when its gate is a
 * source-shape one, and this file splits again when it nears the 300-code-line cap.
 */
import type { LintGateDeclaration } from "./types.js";

/**
 * The source-shape rows, keyed by refusal id. Spread into `./declarations.ts`'s `LINT_GATE_DECLARATIONS`,
 * which stays the one table every consumer reads.
 */
export const SOURCE_SHAPE_LINT_GATE_DECLARATIONS = {
  "cli-command-boundary": {
    caught:
      "a product module imports a verb module under src/cli/commands, which makes a verb a library, and seventeen such imports once grew there one reasonable helper at a time",
    correction:
      "move what the module needs down to the tree that owns the concept, and have the verb import it from there",
    exceptions: [
      "a file under src/cli itself, which is the verb surface",
      "a dynamic import() thunk that defers loading a verb, which is outside the criterion",
    ],
    gate: "cli-command-boundary",
  },
  "cognitive-complexity": {
    caught: "a function scores over the branch-and-nesting ceiling, which is the shape that stops being reviewable",
    correction: "decompose it into a pure core and a thin shell, or hoist a compound condition into a named boolean",
    exceptions: ["a flat switch over a closed union, which scores low and is meant to"],
    gate: "cognitive-complexity",
  },
  "control-bytes": {
    caught: "a text file carries a control character, which is invisible in review and changes what a parser sees",
    correction: "delete the byte; if it is meant to be data, encode it rather than embedding it raw",
    exceptions: ["a tab or newline, which are not in the criterion at all"],
    gate: "control-bytes",
  },
  "epoch-arithmetic": {
    caught:
      "an epoch is scaled into an instant by hand, and four independent copies of that conversion once stood here at once, two of them wrong",
    correction: "call the seconds-to-ISO helper in the date module, or the Slack timestamp helpers for a provider ts",
    exceptions: [
      "a millisecond value with no arithmetic at all",
      "a window bound, whose top-level operator is a subtraction",
    ],
    gate: "epoch-arithmetic",
  },
  "error-shape-threshold": {
    caught:
      "a directory authors more distinct plain error message shapes into err/errAsync than the threshold allows, so its failures have multiplied past what the plain string list was kept for — the owner's pick on the After 265 Landings audit, that a domain past N shapes declares its typed union rather than growing the list",
    correction:
      "declare the directory's <Domain>Error discriminated union and <Domain>Errors factory (error-handling.md) and route its failures through it; a union site and a forwarded message are not shapes, so the count falls as sites move",
    exceptions: [
      "a message forwarded from another domain, which is counted where it was authored",
      "a directory at or under the threshold, which the rule leaves on the plain string list on purpose",
    ],
    gate: "error-shape-threshold",
  },
  "error-shape-threshold-rebaseline": {
    caught:
      "a rebaseline was asked to record MORE distinct error shapes in a directory than its debt entry already carries",
    correction:
      "route the new shapes through the directory's typed union, then rebaseline; the debt list only ever ratchets down",
    exceptions: [
      "a directory whose first entry is being added, which is a widening of the list rather than of an entry",
    ],
    gate: "error-shape-threshold",
  },
  "hand-rolled-result": {
    caught:
      "a union of object literals declares a success flag with a literal true, which is a Result type written by hand",
    correction:
      "use the neverthrow aliases in the result module, and give a domain with distinct failure kinds its own typed union",
    exceptions: [
      "a success FLAG on a record carrying the same payload either way",
      "a provider wire envelope with no failure arm",
    ],
    gate: "hand-rolled-result",
  },
  "house-rules": {
    caught:
      "a house rule the linter used to own is broken — an empty-string coalesce, a direct-invocation guard, a double cast, or a hand-rolled durable write",
    correction: "fail loud instead of coalescing, and take a crash-durable write from the atomic-write module",
    exceptions: ["a null check with a loose comparison, which is deliberately allowed"],
    gate: "house-rules",
  },
  "jsdoc-tags": {
    caught:
      "an exported function's documentation is missing, stale, or adds nothing its own parameter name did not already give, or a JSDoc tag sits where the compiler does not read it",
    correction:
      "write prose and a returns tag, either describe a parameter in words its name lacks or omit the tag, and reword a backtick run that swallows a tag",
    exceptions: [
      "a function returning nothing, which needs no returns tag",
      "a parameter whose name already says everything",
    ],
    gate: "jsdoc-tags",
  },
  "max-function-lines": {
    caught: "a function is longer than the cap, which is the length at which a reader stops holding the whole body",
    correction:
      "decompose it into pure cores and a thin shell, or mark it with the reason-bearing max-lines source marker",
    exceptions: ["a function already carrying the max-lines source marker with a stated reason"],
    gate: "max-function-lines",
  },
  "named-object-params": {
    caught:
      "a signature written in this repository takes more than one parameter, or one positional value a call site cannot name",
    correction: "take a single options object, and inherit a callback's type rather than restating it",
    exceptions: [
      "a type predicate, which the compiler forbids destructuring in",
      "a parameter with no annotation and no default, whose shape a consumer chose",
      "an inline callback, a sole rest parameter, or a zero-parameter function",
    ],
    gate: "named-object-params",
  },
  "named-object-params-heap": {
    caught:
      "the whole-repo Program this gate holds needs more heap than its budget, which is repository growth rather than anything in the diff",
    correction:
      "never raise the budget constant: measure where the heap goes with the gate's own phase report, cut what the gate holds or resolves, and if nothing more can be cut put a Queue card to the owner with that measurement",
    exceptions: ["nothing — the scan itself was clean, so there is no code defect to excuse here"],
    gate: "named-object-params",
  },
  "no-nested-ternaries": {
    caught: "a conditional expression has another one inside a branch, which the owner ruled against reading",
    correction: "rewrite it as if and else-if, hoisting a compound condition into a named boolean first",
    exceptions: ["a single conditional whose branches are both plain values"],
    gate: "no-nested-ternaries",
  },
  "no-silent-fallback": {
    caught:
      "a value is substituted for an absent one by an operator, or by a call to a pass-through fallback helper, rather than by a line of code saying so — how a display name silently became a platform id, and how a required value was renamed off this list",
    correction:
      "a value that must exist: a typed error at the read naming what its absence means, a different one for a malformed value; an invariant: an honest non-null assertion with its reason; absence by design: unsetFieldAsNull on a key its record declares optional, flagValueOr for a flag, or an if that returns",
    exceptions: [
      "a logical OR whose right operand tests something rather than supplying a value, which is a boolean condition and outside the criterion",
      "optional chaining, which propagates the absence to the reader instead of hiding it; and a call to unsetFieldAsNull, whose key the compiler has already proved optional",
    ],
    gate: "no-silent-fallback",
  },
  "no-silent-fallback-rebaseline": {
    caught: "a rebaseline was asked to record MORE fallback sites in a file than its debt entry already carries",
    correction: "remove the new sites, then rebaseline; the debt list only ever ratchets down",
    exceptions: ["a file whose first entry is being added, which is a widening of the list rather than of an entry"],
    gate: "no-silent-fallback",
  },
  "boundary-schema": {
    caught:
      "a hand-written client fetches a provider's answer and reads it as JSON with no strict schema per endpoint, so a renamed or added field is read as absence",
    correction:
      "declare the endpoint with defineBoundary and a z.strictObject schema read against the live answer, or reach the provider through its official SDK",
    exceptions: [
      "a body that is not a provider's answer at all, which is a sharpening of the criterion rather than a debt row",
    ],
    gate: "boundary-schema",
  },
  "outbound-form-strict": {
    caught: "an outbound schema is built with a raw constructor, so an unknown field is ignored rather than refused",
    correction: "build it with the strict-form helper, which refuses an undeclared field by name",
    exceptions: ["a schema that is not an outbound form at all"],
    gate: "outbound-form-strict",
  },
  "primitive-ratchet": {
    caught:
      "a new top-level function's body is structurally identical to a registered canonical primitive, which is how one drifted to fourteen copies in a day",
    correction: "call the registered primitive instead of restating it",
    exceptions: ["a body that genuinely differs from every registered primitive"],
    gate: "primitive-ratchet",
  },
  "primitive-ratchet-registry": {
    caught:
      "a registered canonical primitive names a top-level function that is no longer in the file it points at, so the ratchet is comparing against nothing",
    correction:
      "point the register row at the primitive's current name and file, or drop the row if the primitive is genuinely gone",
    exceptions: ["a rename that is being landed in the same change as the register update"],
    gate: "primitive-ratchet",
  },
  "redos-check": {
    caught: "a regular expression can backtrack catastrophically, so an input a caller controls can hang the process",
    correction: "make the quantified parts disjoint, or replace the pattern with two cheap checks",
    exceptions: ["a pattern with no nested or adjacent quantifiers, which is outside the criterion"],
    gate: "redos-check",
  },
  "runtime-dependencies": {
    caught:
      "a package the plugin's CLI reaches at run time is declared only in devDependencies, or not at all, so the runtime-only install a plugin user gets leaves it out and the verb throws ERR_MODULE_NOT_FOUND on first use",
    correction:
      "move the package to `dependencies` in package.json with the same exact pin; a package reached by a spawned binary or a computed load joins RUNTIME_TOOLS in src/devLint/runtimeDependencies.ts",
    exceptions: [
      "a module reached only from a `dev` verb or a lint gate, which a plugin user never runs and which the CLI loads through no import the bundle follows",
    ],
    gate: "runtime-dependencies",
  },
  "typescript-import-seam": {
    caught:
      "a module names the TypeScript package outside its four seam files, or reads a `SyntaxKind` range marker TypeScript 7 does not keep, so moving the library stops being a change to four files",
    correction:
      "import `ts` and the helpers from `src/lib/tsSyntax.ts` (parsing and walking), `src/lib/tsProject.ts` (configs and resolution) or `src/lib/tsLazy.ts` (a hot path that must not load the compiler at import); ask a range question through a named predicate such as `isAssignmentOperator`",
    exceptions: [
      "named-object-params, which alone imports the checker through `src/lib/tsCompiler.ts`",
      "a comment or string that only mentions the package, which is not an import and is never read as one",
    ],
    gate: "typescript-import-seam",
  },
  "unbounded-spread": {
    caught:
      "a collection whose size comes from DATA is appended by spreading, which copies the whole thing on every element",
    correction: "push onto the accumulator, or build the array once from a single pass",
    exceptions: ["a spread of a bounded, known-small literal"],
    gate: "unbounded-spread",
  },
  "whole-file-json": {
    caught: "a payload whose size is set by DATA passes through one string, and one such write went out at 282 MiB",
    correction: "stream the records line by line with the corpus reader, or write through the atomic streaming writer",
    exceptions: ["one record, one log line or one report, whose size the code that shaped it bounds"],
    gate: "whole-file-json",
  },
  "whole-file-json-debt": {
    caught:
      "a registered whole-payload site stopped firing, so the debt list now describes something that is no longer there",
    correction:
      "remove the stale entry from the debt list, which is how that list stays a measurement rather than a memory",
    exceptions: ["an entry that still fires, which is the list doing its job"],
    gate: "whole-file-json",
  },
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
