/**
 * The program the `named-object-params` unit tests drive the scanner over — one fixture file, the real lib
 * declarations, and an optional decision sink — shared by the findings tests and the decision-stream tests so both
 * judge the same compile.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ts from "#lib/tsCompiler.js";
import { registerTypeScriptCloser } from "#lib/tsLifecycle.js";

import {
  type NamedObjectParamsDecisionRow,
  type NamedObjectParamsViolation,
  scanNamedObjectParams,
} from "../devLint/namedObjectParams.js";

/** The name every fixture's rows and findings carry, whichever temporary directory it was compiled in. */
export const FIXTURE = "/fixture.ts";

/**
 * The compiler options every fixture compiles under: strict, no ambient types, and the full ESNext lib as the
 * target's default — the 7.1 server loads no `lib` named by its file name (`lib.esnext.full.d.ts` reads as
 * twelve TS2318s), so the default is how this fixture gets it.
 */
const OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  types: [],
};

/** The compiler server one test file shares, once started. */
let client: ts.API | undefined;

/**
 * The compiler server, started on first use and shared by every case in a test file: the server keeps the parsed
 * lib, so only the fixture itself is compiled per case. Its close is registered at start, so the shared teardown
 * closes it after the file; a later file starts its own.
 *
 * @returns the live client
 */
function compiler(): ts.API {
  if (client === undefined) {
    const opened = new ts.API({ cwd: process.cwd() });
    client = opened;
    registerTypeScriptCloser({
      close: () => {
        if (client === opened) {
          client = undefined;
        }
        opened.close();
      },
    });
    return opened;
  }
  return client;
}

/**
 * Report a row or a finding under {@link FIXTURE}, so an expectation never names the temporary directory.
 *
 * @param path the name the Program gave the fixture file
 * @param real the fixture file's real path
 * @returns `FIXTURE` for the fixture, any other path unchanged
 */
function asFixture({ path, real }: { path: string; real: string }): string {
  return path === real ? FIXTURE : path;
}

/**
 * Run the scanner over one fixture.
 *
 * A real Program is unavoidable here — the whole point of this gate is that deciding "is this parameter an options
 * bag?" needs resolved types, which no syntactic scan can answer. The compiler reads files from disk, so the fixture
 * is written to its own temporary directory (inside the per-file temp sandbox) and removed afterwards; TypeScript's
 * own `lib.*.d.ts` files come with the compiler, because a checker with no lib has no `Date` or `Map` to be wrong
 * about. Nothing here reaches a shared service.
 *
 * @param source the fixture's TypeScript text
 * @param observe pass true to collect the decision stream as well; omitted, the scan runs as the gate does
 * @returns the violations, the decision rows (empty unless observed), and the compiler's own diagnostic count
 *   so a broken fixture cannot read as a pass
 */
export function scanFixture({ observe, source }: { observe?: boolean; source: string }): {
  readonly diagnostics: number;
  readonly rows: readonly NamedObjectParamsDecisionRow[];
  readonly violations: readonly NamedObjectParamsViolation[];
} {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nop-fixture-")));
  const real = join(dir, "fixture.ts");
  writeFileSync(real, source);
  const program = compiler().createProgram([real], OPTIONS);
  try {
    const sourceFile = program.getSourceFile(real)!;
    // The FIXTURE's semantic diagnostics, never the whole Program's: a lib error is not what this count guards
    // against — a broken fixture reading as a pass is.
    const diagnostics = [
      ...program.getSyntacticDiagnostics(real),
      ...program.getGlobalDiagnostics(),
      ...program.getSemanticDiagnostics(real),
    ];
    const rows: NamedObjectParamsDecisionRow[] = [];
    const checker = program.getProject().checker;
    const onDecision = (row: NamedObjectParamsDecisionRow): void => {
      rows.push({ ...row, path: asFixture({ path: row.path, real }) });
    };
    const found =
      observe === true
        ? scanNamedObjectParams({ checker, onDecision, sourceFiles: [sourceFile] })
        : scanNamedObjectParams({ checker, sourceFiles: [sourceFile] });
    const violations = found.map((violation) => ({ ...violation, path: asFixture({ path: violation.path, real }) }));
    return { diagnostics: diagnostics.length, rows, violations };
  } finally {
    program.dispose();
    rmSync(dir, { force: true, recursive: true });
  }
}
