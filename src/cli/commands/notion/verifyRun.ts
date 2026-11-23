/**
 * `slopweaver notion verify` — the effectful shell. Every decision lives in `./verifyCore.ts` and
 * `../../../outbound/notion/renderFindings.ts`; this file resolves the home, reads a document and prints
 * what came back.
 *
 * Read-only by construction, and it opens nothing at all, per the owner's ruling
 * (`docs/browser-route.md`; what it retired, `docs/browser-route/screenshot-reading-and-retirement.md`):
 * no dedicated profile, no launched Chromium. A Notion page is measured in their own Chrome by the visible
 * session — with no argument this verb prints the brief that says how — and the judgement stays here, where
 * it is pure and cannot be skipped.
 *
 * **The one thing this verb still cannot do for itself, stated plainly.** Its measurement is a PAGE SCRIPT,
 * and no `slopweaver browser` verb runs one: a caller chooses a declared relay operation, never code
 * (`src/browser/datadogConsole.ts`). So the measurement step rides `browser/brief.ts`'s `no-verb-yet` arm
 * and names what would close it — a declared operation beside `src/browser/notionSettingsSnippet.ts`. That step never names `javascript_tool`, which
 * `src/admit/chromeRetirement.ts` refuses
 * outright, so the brief was one no session could carry out at all. The screenshot half IS reachable:
 * `browser shot` photographs a `read-before-write` provider, which Notion is.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIEF_NO_VERB, renderBrief } from "../../../browser/brief.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseNotionReadAddress } from "../../../live/notion/read.js";
import { parseObservation } from "../../../outbound/notion/observation.js";
import { type RenderFinding, type RenderObservation, renderFindings } from "../../../outbound/notion/renderFindings.js";
import { observationScript } from "../../../outbound/notion/renderProbe.js";
import type { NotionVerifyError } from "../../../outbound/notion/verify.errors.js";
import { NotionVerifyErrors } from "../../../outbound/notion/verify.errors.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { notionCommandErrorLines } from "./errors.js";
import {
  type JudgedRender,
  type NotionVerifyArgs,
  notionVerifyExitCode,
  notionVerifyFailureCode,
  notionVerifyFailureLines,
  notionVerifyReportLines,
  parseNotionVerifyArgs,
  proseBlockCount,
} from "./verifyCore.js";

/** Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface NotionVerifyDeps {
  readonly readObservation: (args: { path: string }) => Result<string, NotionVerifyError>;
  readonly rendersDir: (args: { home: string }) => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionNotionVerifyDeps(): NotionVerifyDeps {
  return {
    err: (line) => process.stderr.write(`notion verify: ${line}\n`),
    out: (line) => {
      logger.out({ line });
    },
    readObservation: ({ path }) => readObservationFile({ path }),
    rendersDir: ({ home }) => stateHomePaths({ home }).notionRendersDir,
  };
}

/**
 * Read an observation document from a file, or from stdin when the path is `-`.
 *
 * @param path the file, or `-`
 * @returns the document's text, or why it could not be read
 */
function readObservationFile({ path }: { path: string }): Result<string, NotionVerifyError> {
  try {
    return ok(readFileSync(path === "-" ? 0 : path, "utf8"));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(NotionVerifyErrors.observationUnreadable({ detail, path }));
  }
}

/**
 * A Notion page's canonical web address.
 *
 * Built from the resolved id rather than passed through verbatim, so a bare id, a slugged URL and a URL
 * carrying a `?v=` view parameter all open the same page — and so the address that reaches the browser is
 * one this repository composed rather than one it echoed.
 */
function pageUrlFor({ id }: { id: string }): string {
  return `https://www.notion.so/${id.replaceAll("-", "")}`;
}

/** Where this page's screenshots go: `--out` when passed, else the documented default `renders/<id>`. */
function outDirFor({
  args,
  deps,
  home,
  id,
}: {
  args: NotionVerifyArgs;
  deps: NotionVerifyDeps;
  home: string;
  id: string;
}): string {
  if (args.out === undefined) {
    // --out not passed: the page's own directory under the home's renders.
    return join(deps.rendersDir({ home }), id);
  }
  return args.out;
}

/** Print each line to stdout and return the code. */
function report({ deps, lines, code }: { deps: NotionVerifyDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.out(line);
  }
  return code;
}

/** The machine-readable document, for a caller that is not a person. */
function jsonReport({
  judged,
  findings,
  cellLines,
}: {
  judged: JudgedRender;
  findings: readonly RenderFinding[];
  cellLines: number;
}): string {
  return JSON.stringify(
    {
      cellLineBudget: cellLines,
      findings: findings.map((finding) => ({ kind: finding.kind, message: finding.message })),
      mermaidBlocks: judged.observation.mermaid.length,
      proseBlocks: proseBlockCount({ observation: judged.observation }),
      screenshots: judged.screenshots,
      tableCells: judged.observation.cells.length,
      url: judged.url,
      verified: findings.length === 0,
    },
    null,
    2,
  );
}

/**
 * Print the brief: what to open in the owner's own Chrome, and what to hand back.
 *
 * @param url the page's canonical address
 * @param outDir where the session saves its screenshots
 * @param deps the output seams
 * @returns `EXIT_OK` — printing a brief is a successful run of this mode, not a failure of the other one
 */
function printBrief({ url, outDir, deps }: { url: string; outDir: string; deps: NotionVerifyDeps }): number {
  const lines = renderBrief({
    brief: {
      finish: `slopweaver notion verify ${url} --observation <the JSON that script returned> --out ${outDir}`,
      lane: "notion verify",
      steps: [
        {
          tool: "slopweaver browser shot",
          what: `wait for the page to finish drawing, then save a shot into ${outDir}`,
        },
        {
          script: observationScript(),
          tool: BRIEF_NO_VERB,
          what: "measure the rendered page and keep the JSON it returns",
          wouldClose:
            "a declared relay operation for this observation script, beside `src/browser/notionSettingsSnippet.ts`",
        },
      ],
      url,
    },
  });
  return report({ code: EXIT_OK, deps, lines });
}

/** Print why an `--out` inside a checkout may not be written, and say whether it was refused. */
function outPlacementRefused({
  out,
  home,
  warn,
}: {
  out: string | undefined;
  home: string;
  warn: NotionVerifyDeps["err"];
}): boolean {
  if (out === undefined) {
    return false;
  }
  const placement = refuseProofOutputInTree({
    cwd: process.cwd(),
    env: process.env,
    home,
    output: out,
  });
  if (placement.isOk()) {
    return false;
  }
  for (const line of placement.error) {
    warn(line);
  }
  return true;
}

/**
 * Run `notion verify`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runNotionVerify({ argv, deps }: { argv: readonly string[]; deps: NotionVerifyDeps }): number {
  const parsed = parseNotionVerifyArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (!parsed.isOk()) {
    for (const line of notionCommandErrorLines({ error: parsed.error })) {
      deps.err(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const address = parseNotionReadAddress({ address: args.page, kind: "page" });
  if (address.isErr()) {
    deps.err(address.error.message);
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: args.home });
  // The brief names this directory to the session that takes the shots, so it is asked before either mode.
  if (outPlacementRefused({ home, out: args.out, warn: deps.err })) {
    return EXIT_ERROR;
  }
  const outDir = outDirFor({ args, deps, home, id: address.value.id });
  const url = pageUrlFor({ id: address.value.id });
  if (args.observation === undefined) {
    return printBrief({ deps, outDir, url });
  }
  mkdirSync(outDir, { recursive: true });
  const text = deps.readObservation({ path: args.observation });
  if (text.isErr()) {
    for (const line of notionVerifyFailureLines({ error: text.error })) {
      deps.err(line);
    }
    return notionVerifyFailureCode();
  }
  const observation = parseObservation({ json: text.value, source: args.observation });
  if (observation.isErr()) {
    for (const line of notionVerifyFailureLines({ error: observation.error })) {
      deps.err(line);
    }
    return notionVerifyFailureCode();
  }
  return judgeAndReport({ args, deps, observation: observation.value, outDir, url });
}

/**
 * Judge one measured page and print the report in the selected mode.
 *
 * @param observation what the page said about itself
 * @param outDir where its screenshots were saved
 * @param url the page's address
 * @returns the process exit code
 */
function judgeAndReport({
  args,
  deps,
  observation,
  outDir,
  url,
}: {
  args: NotionVerifyArgs;
  deps: NotionVerifyDeps;
  observation: RenderObservation;
  outDir: string;
  url: string;
}): number {
  const judged: JudgedRender = { observation, screenshots: [outDir], url };
  const findings = renderFindings({ cellLineBudget: args.cellLines, observation });
  const code = notionVerifyExitCode({ findings });
  if (args.json) {
    return report({ code, deps, lines: [jsonReport({ cellLines: args.cellLines, findings, judged })] });
  }
  return report({ code, deps, lines: notionVerifyReportLines({ cellLines: args.cellLines, findings, judged }) });
}

/** `slopweaver notion verify` — brief a page's measurement, then judge what the measurement returned. */
export const notionVerifyCommand = defineCommand({
  run: (argv: readonly string[]) => runNotionVerify({ argv, deps: productionNotionVerifyDeps() }),
});
