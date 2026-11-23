/**
 * The gate that stops a hand-written client reading a provider's JSON without a strict schema per endpoint.
 *
 * ## The rule it enforces
 *
 * Every outbound boundary validates what it reads with a runtime Zod schema per
 * endpoint and fails loudly and early on a missing, renamed or new field. `src/lib/boundary.ts`'s
 * `defineBoundary` is how; this gate is what keeps a new client from skipping it. The first strict read of
 * `/api/oauth/usage` is the evidence it is worth a gate: the plain `z.object` it replaced had been dropping three
 * grant and block fields, and twenty-five top-level ones, without a word (`src/claude/resetStatus.ts`).
 *
 * ## The criterion
 *
 * A non-test source under `src/` that calls a bare `fetch(` (or `globalThis.fetch(`, the Datadog raw-text
 * transport's `requestRawText(`/`requestRawTextWithStatus(`, or a bound `transport.request(` — the Vanta
 * transport's spelling) AND reads a body as JSON in the same file —
 * `.json()`, `JSON.parse(`, `parseJson(`, `parseJsonObject(` or `safeJsonParse(` — must call `defineBoundary`.
 * Every half is read off the SYNTAX TREE, never the text (`./boundarySchemaSyntax.ts`): a call is a call however
 * it is spelled around its name — broken across lines, a comment inside it, optional-chained, handed type
 * arguments — and a comment or string naming one is not one. Five lexical versions fell to exactly those
 * spellings on the Vanta conversion, each counterexample a test.
 *
 * One spelling is narrowed. A MEMBER call `x.parseJson(` is not a JSON read when EVERY declaration of `x` in the file,
 * in whatever scope, is a parameter or `const` annotated with the `Boundary` type this file imports from the boundary
 * module, and no assignment of any shape (destructuring included) targets `x`: then it is the boundary's own strict
 * read, so a typed adapter handed a boundary per call (`src/datadog/rawRequest.ts`) complies without declaring one.
 * Any other member call still counts — a hand-written `parser.parseJson(`, an indexed receiver, a marker-only
 * `Boundary` import, the name bound to anything else in ANY scope, a destructured reassignment — and a namespace
 * import of the parse helpers' modules counts by itself. Scope is deliberately not modelled: six looser
 * versions were broken in review, the last four by finding a JavaScript scoping rule a resolver had missed (an inner shadow, a
 * sibling `case`, a `var` hoisted into a class static block), and each counterexample is a test. The check reads
 * syntax, so the annotation's TRUTH is the compiler's: `Boundary` is a class holding its schema's check in a `#private`
 * field behind a `protected` constructor (`src/lib/boundary.ts`), so it is nominal and the only way in is a strict
 * schema. Neither a hand-written parser with the same methods nor a spread of a
 * real one with `parseJson` swapped can be assigned to one. The residue, stated as a CLASS rather than a list,
 * because each counterexample was another member of it: anything that makes the compiler take a claim it
 * cannot check — a cast, an `any`, a user-defined type predicate or assertion function, an overload wider than its
 * implementation, or a subclass handing `super` a check of its own. The gate is a tripwire against an accidental
 * unvalidated read, never a fence against a deliberate lie to the type checker.
 *
 * The raw-text transport is named because it moves the HTTP machinery into a module that never parses
 * (`src/datadog/rawTransport.ts`): without naming its reads, a caller parsing its text would meet neither half of
 * the criterion and its debt would vanish rather than be paid. `transport.request(` is named for the same reason:
 * the Vanta transport (`src/atlas/vanta/transport.ts`) is that shape too, and its hand-written SDK layer, write
 * clients and token mint read JSON with no boundary until the rule — stay strict, and update our codebase when an
 * upstream provider changes — converted every one of them.
 *
 * ## What it cannot see, stated
 *
 * - **A fetch and its parser split across two files** through any other seam. The reset exchange fetches in one
 *   module and parses in another; neither file alone meets the criterion. Both halves of that pair comply.
 * - **An injected fetch** called under another name (`send(`, `fetchImpl(`), and a JSON read done by a helper
 *   the criterion does not list.
 * - **A call reached around its name**: an alias (`const get = fetch`) or a computed member (`response["json"]()`,
 *   one more case). A WRAPPED callee or receiver (`(fetch)(url)`, `request!(`, `(transport as T).`) is
 *   seen. Nobody spells a read the residue's way by accident, and the gate is a tripwire against the accidental read.
 * - **A `.json` call with any written argument**, a spread of an empty tuple included (`response.json(...none)`,
 *   likewise). Zero written arguments is the criterion because `res.json(body)` is a response WRITER, and an
 *   argument a reader ignores is the same deliberate spelling as an alias.
 * - **An official SDK's response.** An official SDK types its answer at compile time and validates nothing at
 *   runtime; the steer names those reads too, and they are a separate row rather than this criterion's
 *   ([provider SDKs](../../docs/provider-sdks.md#validate-what-you-read)). A hand-written SDK over a bound
 *   transport — Vanta's `src/atlas/vanta/sdk/` — is not this blind spot: it calls `transport.request(`.
 *
 * ## The debt
 *
 * `./boundarySchemaDebt.ts` lists every file that met the criterion when the gate landed. An entry that stops
 * firing FAILS the gate, so a converted client deletes its own row and the list only shrinks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportEmptySelection } from "../lib/textFileScan.js";
import { BOUNDARY_SCHEMA_DEBT } from "./boundarySchemaDebt.js";
import {
  callsFetch,
  declaresBoundary,
  readsJsonByCall,
  unlicensedMemberParse,
  withParsedSource,
} from "./boundarySchemaSyntax.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** A module recorded as owing a boundary when the gate landed. */
export interface BoundaryDebt {
  readonly path: string;
  /** What converting it means, specifically enough to act on. */
  readonly owes: string;
}

/**
 * A word every fetch spelling `callsFetch` recognises holds verbatim — `fetch`, `requestRawText…`,
 * `transport.request` — so a file naming neither cannot fire, and the parse is skipped for most of the tree. A
 * unicode escape is parsed too, since `fetch(` is the same identifier with neither word in its text.
 */
const FETCH_WORD = /fetch|request|\\u/;

/** Sources are the scope; tests and the lint tree itself are not clients. */
function inScope({ path }: { path: string }): boolean {
  return (
    path.startsWith("src/") &&
    path.endsWith(".ts") &&
    !path.endsWith(".test.ts") &&
    !path.startsWith("src/__tests__/") &&
    !path.startsWith("src/devLint/")
  );
}

/**
 * Whether one source reads a provider's JSON through a bare fetch without declaring a boundary.
 *
 * @param content the file's text
 * @param path the file's repo-relative path, which a relative import of the boundary module resolves against
 * @returns true when the file meets the criterion and so owes a `defineBoundary`
 */
export function owesBoundary({ content, path }: { content: string; path: string }): boolean {
  if (!FETCH_WORD.test(content)) {
    return false;
  }
  return withParsedSource({
    content,
    use: (source): boolean => {
      const readsJson = readsJsonByCall({ source }) || unlicensedMemberParse({ path, source });
      return callsFetch({ source }) && readsJson && !declaresBoundary({ source });
    },
  });
}

/**
 * Split what fired into what the debt list already carries, what is new, and which debt rows no longer fire.
 *
 * @param firing every path that met the criterion
 * @param debt the recorded debt
 * @returns fresh hits and stale debt rows, each sorted
 */
export function judgeBoundaryDebt({ firing, debt }: { firing: readonly string[]; debt: readonly BoundaryDebt[] }): {
  readonly fresh: readonly string[];
  readonly stale: readonly string[];
} {
  const recorded = new Set(debt.map((row) => row.path));
  const fired = new Set(firing);
  return {
    fresh: firing.filter((path) => !recorded.has(path)).toSorted(),
    stale: debt
      .map((row) => row.path)
      .filter((path) => !fired.has(path))
      .toSorted(),
  };
}

/**
 * Scan every source, print each fresh hit and stale debt row, and return an exit code.
 *
 * @returns 0 when clean, 1 when a client reads JSON with no boundary, a debt row is stale, or the scan could not run
 */
export function runBoundarySchema(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    files = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ, so the gate has no subject to judge
    process.stderr.write("boundary-schema: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const selected = files.filter((path) => inScope({ path }));
  const firing: string[] = [];
  const unreadable: string[] = [];
  for (const path of selected) {
    try {
      if (owesBoundary({ content: readFileSync(join(root, path), "utf8"), path })) {
        firing.push(path);
      }
    } catch {
      unreadable.push(path);
    }
  }
  const unseen =
    unreadable.length +
    reportEmptySelection({
      label: "boundary-schema",
      selected: selected.length,
      write: (text) => {
        process.stderr.write(text);
      },
    });
  return report({ judged: judgeBoundaryDebt({ debt: BOUNDARY_SCHEMA_DEBT, firing }), unreadable, unseen });
}

/** Print the outcome. */
function report({
  judged,
  unreadable,
  unseen,
}: {
  judged: { readonly fresh: readonly string[]; readonly stale: readonly string[] };
  unreadable: readonly string[];
  unseen: number;
}): number {
  for (const path of judged.fresh) {
    process.stderr.write(`  ${path}  fetches and reads JSON with no defineBoundary\n`);
  }
  for (const path of judged.stale) {
    process.stderr.write(`  ${path}  is on the debt list but no longer fires — delete its row\n`);
  }
  for (const path of unreadable) {
    process.stderr.write(`  ${path}  (unreadable — not checked)\n`);
  }
  const outcome = gateOutcome({ refused: judged.fresh.length + judged.stale.length, unseen });
  if (outcome === "clean") {
    process.stdout.write(`boundary-schema: clean (${String(BOUNDARY_SCHEMA_DEBT.length)} recorded debt)\n`);
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a file that could not be read was not checked, so this reports
    // the gap rather than a policy verdict over it
    process.stderr.write("boundary-schema: a source could not be read, so this scan is incomplete, not clean.\n");
    return 1;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "boundary-schema" }),
      detail: `${String(judged.fresh.length)} client(s) read JSON with no boundary, ${String(judged.stale.length)} stale debt row(s)`,
    })}\n`,
  );
  return 1;
}
