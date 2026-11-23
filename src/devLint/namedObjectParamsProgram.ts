/**
 * What the `named-object-params` gate scans: the checkout and its git listing, the lint config read from that
 * root, and the compiler the Program is built on. Its own module so the runner
 * (`./namedObjectParamsRun.ts`) keeps to the verdict, and so a root other than this checkout — the fixed subject tree the decision stream is written over
 * (`./namedObjectParamsOracle.ts`) — is built exactly the way the gate builds its own.
 */

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "#lib/tsCompiler.js";
import { registerTypeScriptCloser } from "#lib/tsLifecycle.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { isScopedPath } from "./namedObjectParams.js";
import { isInsideSubject } from "./namedObjectParamsOracle.js";

/** The config this rule is scanned under: `tsconfig.json`'s options, narrowed to `src/`, `eval/` and `hooks/`. */
const CONFIG_FILE = "config/typescript/tsconfig.lint.json";

/**
 * Start a compiler server rooted at `cwd`, its close registered with `#lib/tsLifecycle.js` at that same moment, so
 * the gate entry (or a test file's teardown) closes it however the run ends. Rooted at the checkout a Program is
 * built over, because a default the compiler reads off its working directory then reads off that checkout.
 *
 * @param cwd the directory the server treats as current
 * @returns the started client
 */
export function startCompiler({ cwd }: { cwd: string }): ts.API {
  const api = new ts.API({ cwd });
  registerTypeScriptCloser({
    close: () => {
      api.close();
    },
  });
  return api;
}

/**
 * A compiler diagnostic's own text on one line, its chained messages after it.
 *
 * @param diagnostic the diagnostic to read
 * @returns the message, ready to print
 */
export function diagnosticMessage({ diagnostic }: { diagnostic: ts.Diagnostic }): string {
  const parts = [diagnostic.text];
  if (diagnostic.messageChain !== undefined) {
    for (const link of diagnostic.messageChain) {
      parts.push(diagnosticMessage({ diagnostic: link }));
    }
  }
  return parts.join(" ");
}

/**
 * Remove whatever an EARLIER run left at the decision stream path, so this run's failure cannot leave it
 * passing for this run's output — unless the path lies inside `boundary`, where it may be one of the subject's
 * own files and is never touched.
 *
 * @param decisionStreamPath the named stream path
 * @param boundary the subject root, or the directory the run named when no root could be resolved from it;
 *   absent when the run named no subject at all, so there is nothing the path could belong to
 * @param write the gate's stderr sink
 * @returns whether the path is now clear and outside the boundary
 */
export function clearDecisionStream({
  boundary,
  decisionStreamPath,
  write,
}: {
  boundary?: string | undefined;
  decisionStreamPath: string;
  write: (text: string) => void;
}): boolean {
  if (boundary !== undefined && isInsideSubject({ path: decisionStreamPath, root: boundary })) {
    // devlint: not-a-refusal -- a usage fact: a stream inside the subject would be an unlisted file to its next run
    write(`named-object-params: the decision stream ${decisionStreamPath} lies inside the subject ${boundary}\n`);
    return false;
  }
  try {
    rmSync(decisionStreamPath, { force: true });
  } catch {
    // devlint: not-a-refusal -- a usage fact: the named path holds something a stream cannot replace
    write(`named-object-params: the decision stream ${decisionStreamPath} could not be cleared\n`);
    return false;
  }
  return true;
}

/**
 * The checkout a run judges and its in-scope working-tree listing, or `undefined` once the reason it has none
 * is printed: git could not read it, or a named decision stream would land inside it, where the next run over
 * that subject would meet a file its git does not report. A named stream path is cleared here, before anything
 * else can fail, so a failed run leaves no earlier run's file standing in for its own — when git fails too,
 * judged against the root if it resolved and against the directory the run named if it did not.
 * A file the filesystem will not let it remove (a read-only directory) stays where it is: the run exits 1
 * naming that path, and no code in this process can do better.
 *
 * @param decisionStreamPath where the decision stream goes; absent in the gate run
 * @param resolveRoot the checkout to scan, resolved inside the git guard so a failure is reported, not thrown
 * @param subjectDir the directory a subject run named, the boundary a stream is cleared against when no root resolves
 * @param write the gate's stderr sink
 * @returns the root and its listing, or `undefined` when there is no subject to judge
 */
export function readSubject({
  decisionStreamPath,
  resolveRoot,
  subjectDir,
  write,
}: {
  decisionStreamPath?: string | undefined;
  resolveRoot: () => string;
  subjectDir?: string | undefined;
  write: (text: string) => void;
}): { readonly listed: readonly string[]; readonly root: string } | undefined {
  let root: string | undefined;
  let listed: readonly string[];
  try {
    root = resolveRoot();
    listed = workingTreeFilesOf({ root }).filter((path) => isScopedPath({ path }));
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    write("named-object-params: not a git checkout (git failed)\n");
    // Git failing after the root resolved leaves that root the boundary; failing before, the named directory.
    if (decisionStreamPath !== undefined && root !== undefined) {
      clearDecisionStream({ boundary: root, decisionStreamPath, write });
    } else if (decisionStreamPath !== undefined) {
      clearDecisionStream({ boundary: subjectDir, decisionStreamPath, write });
    }
    return undefined;
  }
  if (decisionStreamPath !== undefined && !clearDecisionStream({ boundary: root, decisionStreamPath, write })) {
    return undefined;
  }
  return { listed, root };
}

/**
 * Build the Program this gate needs over the checkout at `root`, or the reason it could not be built. The
 * config is the one inside `root`, so a subject tree resolves its own `include` and its own `node_modules`, and
 * its `include`/`extends` are read relative to the config's OWN directory, as `tsc` reads them.
 *
 * The Program lives on a compiler server rooted at `root`; nothing in this rule reads a JSDoc node, and the
 * server's parse of one stays on the server.
 *
 * @param root the checkout whose lint config, sources and dependencies the Program is built from
 * @returns the Program, or a one-line failure naming the config
 */
export function buildProgram({
  root,
}: {
  root: string;
}): { readonly program: ts.Program } | { readonly failure: string } {
  const configPath = resolve(root, CONFIG_FILE);
  const api = startCompiler({ cwd: root });
  let parsed: ts.ParsedCommandLine;
  try {
    parsed = api.parseConfigFile(configPath);
  } catch (thrown: unknown) {
    return { failure: `${CONFIG_FILE}: ${thrown instanceof Error ? thrown.message : String(thrown)}` };
  }
  const first = parsed.errors[0];
  if (first !== undefined) {
    return { failure: `${CONFIG_FILE}: ${diagnosticMessage({ diagnostic: first })}` };
  }
  return { program: api.createProgram(parsed.fileNames, parsed.options) };
}
