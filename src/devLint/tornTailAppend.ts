/**
 * The torn-tail-append gate — one destination for every append to a line-oriented file in the repo.
 *
 * ## Why a gate rather than a note
 *
 * A process killed partway through an append leaves its file without a trailing newline, and the next record written
 * straight on fuses with that fragment into one line no reader can parse. The guard against it existed — a shared
 * `needsSeparator` probe and private copies of it — and of the 88 appends this criterion matched, 74
 * plus four callers of a durable-append helper, 78 call sites, used none (the
 * measurement and its repro are in `src/lib/appendSeparator.ts`). A seeded torn tail made `recordLoopBreakage` write one death record twice.
 * Each of those appends was written carefully; what was missing was one function for a rule to name. Now every append
 * goes through `appendLines` (`src/lib/appendSeparator.ts`), and this gate refuses one that does not.
 *
 * ## The criterion
 *
 * Read off the TypeScript AST, and only through a binding imported from `node:fs`, `fs`, `node:fs/promises` or
 * `fs/promises` — a named import (aliased or not), a namespace or default import, the `promises` member, or a
 * `const`/`let` alias or destructure of any of those in the same file. A member is read by dot or by literal key,
 * through parentheses, a type assertion or a `(0, f)` prefix, and a `.call`/`.apply` is resolved to what it invokes:
 *
 * - `append-call` — a call to `appendFileSync` or `appendFile`.
 * - `append-open` — a call to `openSync` or `open` whose flags argument is one of Node's append flag strings
 *   (`"a"`, `"ax"`, `"a+"`, `"ax+"`, `"as"`, `"as+"`), or an expression naming `O_APPEND`, either one directly or through same-file `const`s.
 * - `append-flag-write` — a call to `writeFileSync`, `writeFile` or `createWriteStream` whose options object,
 *   inline or in a same-file `const`, carries a `flag` or `flags` that is one of those strings.
 * - `append-method` — a method call named `appendFile` or `appendFileSync` on any receiver: the one syntax-level
 *   heuristic, there because a promises `FileHandle` has no import to bind to.
 *
 * The criterion as code is `./tornTailAppendShape.ts`.
 *
 * The binding is what keeps the criterion honest: a domain function that takes `{ flag: "answer" }` is not a write.
 *
 * ## Blind spots, stated rather than discovered
 *
 * A `require("node:fs")`, a dynamic `import()`, an fs function or module reaching another name by any route but a
 * same-file `const`/`let` alias (a parameter, a `.bind`, a property of another object, a computed key; and a `let`
 * whose name the file reassigns anywhere, which may no longer hold the fs function when called), an fs function
 * invoked with `new` rather than called, a callee wrapped in anything but parentheses, a type assertion, `!`,
 * `satisfies` or a comma prefix (`(await appendFileSync)(p, row)`, a conditional, a call returning the function),
 * a numeric flags literal (`openSync(p, 9)`, whose meaning is the platform's), and a flags value or options object computed at run time or reached through anything but a same-file `const` (followed
 * through spreads, members of a `const` object literal and one level of an object destructure, up to eight hops; a
 * nested or array destructure, or a destructure's rest element, is not followed) are all outside the criterion. A name
 * an inner scope redeclares is not the binding (`./tornTailAppendScope.ts`), and a `const` is read in the scope of
 * its use. Aliases are keyed by name file-wide, erring toward a flag: a top-level declaration sharing the name of an
 * alias made inside a function is read as that alias, and a name bound to two fs exports in two scopes is read as
 * either, so a call through it is flagged when either one appends. A flags
 * expression is never evaluated, so one that names `O_APPEND` only to mask it off (`O_APPEND & 0`) is still flagged,
 * and an `appendFile`/`appendFileSync` call is flagged whatever `flag` it is handed: one told to overwrite is an
 * append API misused, and belongs in `writeFileAtomic` instead. A member of the module a file overwrites
 * (`io.openSync = …`) is still read as the fs function: assignments to members are not tracked. And
 * the criterion judges each append on its own, never two processes racing one file: that limit is
 * `src/lib/appendSeparator.ts`'s, stated in its header. Tests are not scanned: a test seeding a torn
 * or malformed tail is doing so on purpose. Nor is a file whose basename is one of this gate's own, the
 * `gateSelfFiles` convention every gate here shares, which matches by basename anywhere in the tree.
 *
 * Pure {@link scanTornTailAppend} + {@link partitionAgainstDebt}, and an effectful {@link runTornTailAppend} edge,
 * matching the other gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Result } from "#lib/result.js";
import { withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { decodeDebtList, identitiesAreUnique, readCommittedInput } from "./decodeDebtList.js";
import type { DevLintInputError } from "./errors.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";
import { appendCallsIn, type TornTailAppendShape } from "./tornTailAppendShape.js";

/**
 * One append outside the shared primitive.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface TornTailAppendHit {
  readonly path: string;
  readonly line: number;
  readonly shape: TornTailAppendShape;
  readonly excerpt: string;
}

/**
 * One recorded descriptor append, and how many times it fires in its file.
 *
 * @internal — the debt list's own row shape; nothing outside this gate names it.
 */
export interface TornTailAppendDebt {
  readonly path: string;
  readonly shape: TornTailAppendShape;
  readonly count: number;
  /** The guard it keeps on its own descriptor, which is why it is not routed through `appendLines` yet. */
  readonly guard: string;
}

/** The module every other append is routed through, so the one place an append may be written. */
const APPEND_OWNER = "src/lib/appendSeparator.ts";

/**
 * Every append in `content` that does not go through the shared primitive. Pure — parses in memory with the
 * TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting, and to exempt the primitive itself)
 * @param content the file's text
 * @returns each append, in source order
 */
export function scanTornTailAppend({ path, content }: { path: string; content: string }): readonly TornTailAppendHit[] {
  if (path === APPEND_OWNER) {
    return [];
  }
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly TornTailAppendHit[] =>
      appendCallsIn({ sf }).map(({ call, shape }) => ({
        excerpt: call.getText(sf).split("\n")[0]!.slice(0, 120),
        line: sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1,
        path,
        shape,
      })),
  });
}

/**
 * The committed DEBT — the descriptor appends that keep their own torn-tail guard on a descriptor they must hold
 * across other checks, measured by running this gate (`yarn tsx src/devLint/tornTailAppend.entry.ts`).
 *
 * **A debt list, not an allowlist.** Each entry is an append outside the one primitive, recorded with the guard it
 * keeps instead; none is a shape the criterion should not have matched. `count` is how many times it fires in its
 * file, so a SECOND append added beside a recorded one is still a new hit, and an entry that fires fewer times than
 * it records is stale and fails the gate as loudly, so the list only shrinks. Being a registered baseline, a row
 * added or raised is also a loosening against main that only a witnessed bump record lands.
 */
const BASELINE_FILE = ".baselines/torn-tail-append-baseline.json";

/**
 * One row of the committed list: a shape this gate names, a positive count, and a non-blank guard. Strict, and one
 * row per path and shape, so an unread field or a second row for one identity is refused rather than dropped or
 * folded into the first.
 */
const BaselineSchema = z.strictObject({
  appends: z
    .array(
      z.strictObject({
        count: z.number().int().positive(),
        guard: z.string().trim().min(1),
        path: z.string().min(1),
        shape: z.enum(["append-call", "append-open", "append-flag-write", "append-method"]),
      }),
    )
    .refine((rows) => identitiesAreUnique({ identity: (row) => `${row.path} ${row.shape}`, rows })),
});

/**
 * Decode the committed debt list's text. Pure.
 *
 * @param text the contents of `.baselines/torn-tail-append-baseline.json`
 * @returns the recorded appends, or which half of the decode failed
 */
export function parseTornTailAppendBaseline({
  text,
}: {
  text: string;
}): Result<readonly TornTailAppendDebt[], DevLintInputError> {
  return decodeDebtList({
    label: "torn-tail-append baseline",
    schema: BaselineSchema,
    shape: "{ appends: [{ path, shape, count, guard }, …] }, one row per path and shape",
    text,
  }).map((baseline) => baseline.appends);
}

/**
 * Split a scan's hits into the ones the committed list already records and the ones it does not, plus the debt
 * entries that fire fewer times than they record. Keyed on `path` + `shape` and compared by COUNT, so moving a
 * recorded call within its file is not a failure, while a second append added beside it is.
 *
 * @param hits every hit the scan produced
 * @param debt the recorded debt
 * @returns every hit in a file and shape whose count exceeds its record, and each over-recorded entry
 */
export function partitionAgainstDebt({
  hits,
  debt,
}: {
  hits: readonly TornTailAppendHit[];
  debt: readonly TornTailAppendDebt[];
}): { readonly fresh: readonly TornTailAppendHit[]; readonly stale: readonly string[] } {
  const keyOf = ({ path, shape }: { path: string; shape: TornTailAppendShape }): string => `${path} ${shape}`;
  const recorded = new Map(debt.map((entry) => [keyOf(entry), entry.count]));
  const fired = new Map<string, number>();
  for (const hit of hits) {
    fired.set(keyOf(hit), countOf({ counts: fired, key: keyOf(hit) }) + 1);
  }
  return {
    fresh: hits.filter(
      (hit) => countOf({ counts: fired, key: keyOf(hit) }) > countOf({ counts: recorded, key: keyOf(hit) }),
    ),
    stale: debt
      .filter((entry) => countOf({ counts: fired, key: keyOf(entry) }) < entry.count)
      .map(
        (entry) =>
          `${entry.path} (${entry.shape}): records ${String(entry.count)}, fires ${String(countOf({ counts: fired, key: keyOf(entry) }))}`,
      ),
  };
}

/** How many a tally holds for `key` — a key it never saw was counted zero times, which is absence by design. */
function countOf({ counts, key }: { counts: ReadonlyMap<string, number>; key: string }): number {
  const count = counts.get(key);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/**
 * This gate's declared scan predicate: a `.ts` file under `src/`, `eval/` or `hooks/`, excluding tests (which seed
 * torn tails on purpose) and this gate's own files, whose text necessarily spells the shapes it names.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "tornTailAppend" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/** Print the fresh half of a verdict: each append outside the primitive, then the refusal. */
function reportFresh({ fresh }: { fresh: readonly TornTailAppendHit[] }): void {
  for (const hit of fresh) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)} (${hit.shape}): ${hit.excerpt}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "torn-tail-append" }),
      detail: `${String(fresh.length)} append(s) outside appendLines`,
    })}\n`,
  );
}

/** Print the stale half of a verdict: debt entries that fire fewer times than they record. */
function reportStale({ stale }: { stale: readonly string[] }): void {
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "torn-tail-append-debt" }),
      detail: `${String(stale.length)} DEBT entr(ies) over-recorded`,
    })}\n`,
  );
  for (const entry of stale) {
    process.stderr.write(`  ${entry}\n`);
  }
}

/**
 * IO edge: scan every source file, judge it against the committed debt list, print whichever halves of the verdict have
 * something to say, and return 0 (clean) or 1 (a new append, a stale debt entry, or an incomplete scan).
 *
 * @returns the process exit code
 */
export function runTornTailAppend(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("torn-tail-append: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<TornTailAppendHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanTornTailAppend({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "torn-tail-append",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const debt = readCommittedInput({ kind: "debt list", path: join(root, BASELINE_FILE) }).andThen((text) =>
    parseTornTailAppendBaseline({ text }),
  );
  if (debt.isErr()) {
    // devlint: not-a-refusal -- the committed debt list could not be READ, so the gate has nothing to judge against
    process.stderr.write(`torn-tail-append: ${debt.error.message}\n`);
    return 1;
  }
  const { fresh, stale } = partitionAgainstDebt({ debt: debt.value, hits });
  if (fresh.length > 0) {
    reportFresh({ fresh });
  }
  if (stale.length > 0) {
    reportStale({ stale });
  }
  if (fresh.length > 0 || stale.length > 0 || !complete) {
    return 1;
  }
  process.stdout.write(
    `torn-tail-append: clean (${String(readCount)} sources scanned, ${String(hits.length)} recorded in ${BASELINE_FILE})\n`,
  );
  return 0;
}
