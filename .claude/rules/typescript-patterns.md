# TypeScript Patterns

Hard rules for **all** TypeScript in this repo — source, scripts, tests. Applied everywhere, always.

## Universal named-object params (MANDATORY)

Machine-enforced by the `named-object-params` gate in `yarn lint`. What follows is what that gate checks —
if the prose and the gate ever disagree, that is a defect in one of them, not a licence to pick.

**One failure of that gate is not about your code at all.** It builds a whole-repo `ts.Program`, and one
opening _"NOTHING IN YOUR DIFF BROKE A RULE"_ means the repository outgrew its measured heap; the message carries
the re-measure command. `HEAP_BUDGET_MIB` (`src/devLint/namedObjectParamsHeap.ts`) is **never raised by a
session**: cut what the gate holds; still over, Queue-card the measurement. A second
checker-backed rule joins that Program.

**The subject of this rule is a signature written in THIS repository.** A parameter list chosen by something
you imported is not this rule's business — you cannot change a library's shape, and inventing a wrapper to
satisfy a rule is worse than the positional call it replaces. That single idea generates most of the
exceptions below rather than each being a special case.

**The purpose** — a caller must be able to see every option available, and must not be able to transpose two
arguments. That is what the gate protects, and it is the test to apply when the letter of the rule is unclear.

### The two rules

- **A function you implement** takes at most **one** parameter, and it must be an **options object**.
- **A signature you declare** (an interface method, a function type, a call signature) takes at most **one**
  parameter.

```typescript
// WRONG — two parameters, and both the same type, so transposing them still compiles
function bronzeFile(source: string, window: string): string;
// WRONG — one positional value; `redactText(x)` names nothing at the call site
function redactText(text: string): string;

// CORRECT
function bronzeFile({ source, window }: { source: string; window: ExportWindow }): string;
function redactText({ text }: { text: string }): string;
```

**Destructuring is the preferred spelling, not the bar.** A single object-typed parameter passes whether or
not you destructure it, because the call site still names its fields:

```typescript
// COMPLIANT — `rec({ kind: "pr" })` names its fields; the object is spread wholesale inside
const rec = (over: Partial<CorpusRecord> = {}) => ({ ...DEFAULTS, ...over });
// COMPLIANT — a defaulted destructure is still a destructure
export function resolveRepository({ cwd = process.cwd() }: { cwd?: string } = {}): Result<Repository>;
```

**"Options object" means a bag of fields you own**, not any JavaScript object. `Date`, `Map`, `URL` and
`Uint8Array` are values you pass, not named arguments — `toYyyyMmDd({ date })`, not `toYyyyMmDd(date)`. The
gate decides this by asking whether the type exposes at least one property declared in this repo (or a string
index signature), so `Partial<CorpusRecord>` and `Record<string, unknown>` qualify and `Date` does not.

**A declared signature carries only the arity limit.** Do not extend the object-type requirement to its single
parameter: `(line: string) => void` is a fine callback contract, while `(cursor: string, limit: number)` is
not, because ordering two arguments is the thing being prevented.

### Exceptions — positional is correct

Every one of these is computed by the gate. None is a list of blessed names.

- **Zero-param** functions: `slopweaverHome()`, `githubToken()`.
- **Type predicates and assertion signatures** (`x is T`, `asserts x`) — TypeScript error TS1230 forbids
  destructuring here, so this is the compiler's decision: `isRecord(value): value is Record<…>`.
- **A parameter with no type annotation _and_ no default value.** Under `strict` that cannot compile unless a
  consumer supplied the type, which proves the parameter list was not yours to choose. This is what exempts
  nearly every callback and interface implementation, and it is why you should **inherit** a callback's types
  rather than restate them: `const sink: ProgressSink = (line) => …`, not `function sink(line: string)`.
  A **default value is not** inheritance — `f(value = "x")` compiles because `strict` infers `string` from the
  initializer, locally, so that parameter list is yours and the rule applies.
- **Inline callbacks passed as an argument** — directly, or as a member of an options object literal:
  `.map(x => …)`, `throttle(task => …)`, `defineCommand({ run: argv => … })`.
- **A named function passed by reference as a callback** — `stdin.on("data", onData)` means Node chose
  `onData`'s shape.
- **A sole rest parameter** — `(...parts: string[])` is a list, and one list cannot be transposed.
- **The CLI verb contract** the runtime dictates: `(argv: readonly string[]) => number | Promise<number>`.

There is **no exception for the logger.** `logger.error({ msg })` is deliberate: it is structured logging, so
extra fields can be added later without touching a call site, and an error object can be carried instead of
interpolated into a string. `out({ line })` is the one channel that stays a plain string — it writes raw data
to stdout so piping keeps working — but it still takes an object.

### When a signature genuinely cannot comply

Put a marker on the line directly above it, carrying a reason. A bare marker exempts nothing, and neither does
one placed further away. This keeps an exception visible in the diff instead of hidden in a config file.

```typescript
// named-object-params-exempt: promptfoo invokes Provider.callApi(prompt) positionally and duck-types it
async callApi(prompt: string): Promise<AskProviderResponse> {
```

Reach for it only when a library dictates the shape and there is no import for the gate to detect. If you can
inherit the type instead, do that — it is checked by the compiler, whereas a marker is checked by nobody, bar a `redundant-marker`.

## Other rules

- **No `any`** in any code — use `unknown` + a type guard.
- **Explicit return types** on all exported functions.
- **Inline object types**, not extracted single-use interfaces (extract only when reused/exported as a
  real contract, e.g. `CorpusRecord`).
- **JSDoc prose + `@returns` on all exported functions; `@param` earns its place.** See below — this one is
  machine-enforced, so its exact edges matter.
- Prefer `satisfies` over type assertions; loose `== null` / `!= null` for null checks is fine.
- **Measured comments carry an inline repro command**, not just a number/date; a separate evidence doc
  was rejected as another stale surface. `src/lib/paging.ts` claimed a minimum of 20 after it became 15,
  undetected. Ratchet numbers driving constants instead of restating them in prose.
- **Python is never the tool**: 100% of it becomes typed, tested TypeScript exposed as a
  `slopweaver` verb ([the rationale](../../docs/doctrine-rationale/no-python.md)).
  Gated by `no-python`: no marker, and a DEBT list that fails when an entry stops firing.
- **Raw Bash is refused like Python**: one command piped through read-only filters, or two within 200
  characters. More is a script, so a verb. Hook `raw-bash-gate`, hatch `SLOPWEAVER_ALLOW_BASH=1`
  ([why](../../docs/doctrine-rationale/no-raw-bash.md)).
- **Never let a data-sized payload through one JS string.** `JSON.stringify`/`JSON.parse` are not banned —
  almost every call serialises one record, log line or `--json` report, bounded by the code that shaped it.
  Two mechanisms compose to cover the rest. **Statically**, `whole-file-json`
  (`src/devLint/wholeFileJson.ts`) refuses three shapes whose size comes from data, with no exemption marker
  and a `DEBT` list that fails as loudly when an entry STOPS firing. **At runtime**, where only the data
  knows its size, go through `safeJsonStringify`/`safeJsonParse` (`src/lib/safeJson.ts`): warn at 32 MiB,
  REFUSE at 100 MiB. Read a record stream with `readJsonlLines`
  (`src/corpus/corpusStore.ts`); write one with `writeFileAtomicStream` (`src/lib/writeAtomic.ts`). Every
  number here is measured in those files ([why](../../docs/doctrine-rationale/whole-file-string.md)).
- **Never scale an epoch into a `Date`.** `new Date(x * 1000)` is banned outside `src/lib/date.ts` and
  `src/lib/slackTs.ts`; call `epochSecondsToIso({ seconds })` for a provider's numeric time field, or
  `slackTsToIso` / `slackTsToEpochMs` / `slackTsFromEpochMs` for a Slack `ts`. Gated by
  `epoch-arithmetic` (`src/devLint/epochArithmetic.ts`), which walks the AST, has no
  allowlist and no exemption marker — the legitimate shapes are already outside its criterion. **Four**
  independent `tsToIso` copies stood in this tree at once, two answering `""` on a bad input and two
  `undefined`, and none was wrong: scattered, there was no single function a rule could name. The human half
  is what makes it a rule — a Slack `ts` read 80 minutes wrong reached a board row, two cron schedules and
  two supervisors' deadman deadlines (`skills/slack/reference/timestamps.md`). Derive an instant with
  `slopweaver slack when <ts>`; never compute one by hand, in code or in prose.
- **Reach `src/lib/` by `#lib/…` in code you write** — `package.json` declares the root, most of the tree is
  still relative, and converting it is a follow-up row, so this is prose. Why: `src/lib/subpathImports.ts`.
- **No nested ternaries** — use if statements instead. A ternary whose branch is itself another ternary must be rewritten as if / else-if /
  else, hoisting the tested condition into a named boolean constant when it is compound (not a bare
  identifier or a single comparison). Machine-enforced by the `no-nested-ternaries` gate in `yarn lint`
  (`src/devLint/noNestedTernaries.ts`), which walks the TypeScript AST rather than matching text, with no
  allowlist and no exemption marker.
- **No silent fallback — fail early on what must exist**. A value that must exist gets a
  typed error at the read naming what its absence means, a malformed one a DIFFERENT error, no `null` carried
  on; an invariant, an honest `x!`. Absence by design: `unsetFieldAsNull({ record, key })` (a required key does
  not compile), `flagValueOr`, or an `if` that RETURNS. **Criterion**: `??`, `??=`, `||=`, `||` to a value
  LITERAL, or a call to a pass-through fallback helper. Gate `no-silent-fallback`: no allowlist, no marker, a
  shrinking debt list. [Why](../../docs/doctrine-rationale/no-silent-fallback.md).

## JSDoc on exported functions (enforced by the `jsdoc-tags` gate)

Every exported function carries a JSDoc block with prose and `@returns`. `@param` is **earn-your-place**
(Option B of the code-quality survey, over A/keep-as-is and C/drop-the-mandate): measured on this tree, 69% of `@param`
descriptions already carried three or more words the parameter name itself did not give a reader, and killing
the mandate entirely would have destroyed that real documentation to remove a much smaller filler bucket. The
`jsdoc-tags` gate in `yarn lint` enforces the rule below with no allowlist, so these edges are the contract
rather than a convention:

- **A `@param` may be OMITTED** when its description would add nothing a reader does not already have from
  the parameter's own name — there is no "missing tag" defect here at all.
- **A PRESENT `@param` must add at least one novel word** — a content word neither the parameter's own
  identifier (split on `camelCase`/`snake_case`, lowercased) nor a small fixed glue-word list already gives.
  `@param source the source` is `low-information-param`; `@param source the manifest to embed` is fine. See
  `src/devLint/commentQuality.ts` for the exact test.
- **A stale `@param` still fails — when the gate can see the whole contract.** A tag naming a parameter that
  does not exist is doc rot regardless of whether presence is mandatory — four tags in this repo once named a
  parameter a rename had already removed, and they read perfectly while being false. This check is
  syntax-only, though: a shape it cannot fully resolve (a type reference into an intersection with an
  imported member, say) is `unnameable-param` instead, never a false `stale-param` — see
  `expectedParamNames`'s `complete` flag in `src/devLint/jsdocParamNames.ts`.
- For the named-object shape, a present tag's name must be a **field of the parameter's declared TYPE**,
  written flatly (`@param source`, not `@param root0.source`). Validation reads the declared TYPE rather than
  the destructuring, because a function may deliberately require a field it never binds — a state guard whose
  contents carry nothing, for instance — and a caller still has to pass it.
- **`@returns` is required unless the function returns `void`, `never`, `Promise<void>` or `Promise<never>`,
  and is UNCHANGED by Option B** — always mandatory, always needs a real description, no novel-word test. There
  is no value to describe in the void/never cases, and `@returns nothing` is ceremony. With no return
  annotation at all, the body decides.
- **A line opening `@tag` that the compiler read no tag on fails** (`unread-tag`, JavaScript too): under 7.1 an
  inline run of three or more backticks swallows every later tag, so reword the run.
- **Scope is direct exports**: `export function`, `export const f = …`, and the public METHODS of an exported
  class. Constructors are not gated (no return contract), and non-exported functions are not gated at all —
  they may of course still be commented.
- A block separated from its declaration by a **blank line** documents the FILE and does not count; put a file
  overview above the imports. The gate flags it ANYWHERE a `/**` block sits, not only above an exported
  function, and two more: a block **shadowed** by one stacked directly below it (only the last is read), and a
  verbatim **duplicate** of one earlier in the SAME stack (one line repeated on two unrelated sibling
  declarations is fine). Prose about a file section belongs in a plain `/* */` comment, which this check never
  reads: the deliberate escape hatch.
