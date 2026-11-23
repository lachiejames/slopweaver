/**
 * `slopweaver atlas github report` — print where GitHub's surfaces disagree.
 *
 * No network call and no browser: it reads the published generation and prints what is already in it. It
 * RESOLVES NOTHING, which is the owner's ruling rather than a limitation — which surface wins when two
 * disagree is a decision reserved for the owner until they can see real instances, so this verb's whole job is to
 * put those instances in front of them.
 */
import {
  calledNotDeclared,
  declaredNotExposed,
  type GithubDisagreement,
  summariseDisagreements,
} from "../../../atlas/github/disagreement.js";
import type { GithubRestOperation, GithubWebRequest } from "../../../atlas/github/entities.js";
import type { GithubKindFile } from "../../../atlas/github/kindFiles.js";
import type { GithubKind } from "../../../atlas/github/model.js";
import { type GithubAtlasPaths, githubAtlasPaths, readGithubAtlas } from "../../../atlas/github/store.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { GITHUB_REPORT_USAGE } from "../atlas/githubCore.js";

/** Where the verb sits: past the runtime, the script, the `atlas` noun, the `github` platform and `report`. */
const VERB_DEPTH = 5;

/** The stored operations, or an empty list when the generation holds no operation file. */
function storedOperations({
  snapshot,
}: {
  snapshot: { files: Readonly<Record<GithubKind, GithubKindFile | null>> };
}): readonly GithubRestOperation[] {
  const file = snapshot.files["rest-operation"];
  return file?.kind === "rest-operation" ? file.entities : [];
}

/** The stored web requests, or an empty list when the generation holds no request file. */
function storedRequests({
  snapshot,
}: {
  snapshot: { files: Readonly<Record<GithubKind, GithubKindFile | null>> };
}): readonly GithubWebRequest[] {
  const file = snapshot.files["web-request"];
  return file?.kind === "web-request" ? file.entities : [];
}

/**
 * The lines the report prints, headline first.
 *
 * The second line is not decoration: it states, every time, that this verb picks no winner. Which surface
 * wins when two disagree is a decision the owner has reserved until they can see real instances, and a report
 * that quietly implied otherwise would be the resolver `docs/atlas-intent/04-corroboration.md` forbids.
 *
 * @param disagreements every disagreement found
 * @returns the lines to print, in order
 */
function renderDisagreements({ disagreements }: { disagreements: readonly GithubDisagreement[] }): readonly string[] {
  return [
    summariseDisagreements({ disagreements }),
    "this verb resolves none of them; which surface wins is the owner's call",
    ...disagreements.flatMap((entry) => [`  ${entry.kind}  ${entry.subject}`, `      ${entry.detail}`]),
  ];
}

/** The report's three edges: the published generation, and the two output channels. */
export interface GithubAtlasReportDeps {
  /** Read the published generation's kind files under the resolved atlas paths. */
  readonly readAtlas: (args: {
    paths: GithubAtlasPaths;
  }) => Result<{ readonly files: Readonly<Record<GithubKind, GithubKindFile | null>> }>;
  /** Write one line of report data to stdout. */
  readonly out: (args: { line: string }) => void;
  /** Write one diagnostic line to stderr. */
  readonly error: (args: { msg: string }) => void;
}

/**
 * Read the generation and print where its surfaces disagree — the report's whole body, past the parse.
 *
 * @param values the parsed value flags
 * @param flags the parsed boolean flags
 * @param deps where the generation is read from and where the lines go
 * @returns the process exit code
 */
function runReport({
  values,
  flags,
  deps,
}: {
  values: Readonly<Record<string, string>>;
  flags: ReadonlySet<string>;
  deps: GithubAtlasReportDeps;
}): number {
  const snapshot = deps.readAtlas({ paths: githubAtlasPaths({ home: resolveHome({ named: values["home"] }) }) });
  if (snapshot.isErr()) {
    for (const line of snapshot.error) {
      deps.error({ msg: line });
    }
    return EXIT_ERROR;
  }
  const operations = storedOperations({ snapshot: snapshot.value });
  const requests = storedRequests({ snapshot: snapshot.value });
  const disagreements: readonly GithubDisagreement[] = [
    ...declaredNotExposed({ operations }),
    ...calledNotDeclared({ requests }),
  ];
  if (flags.has("json")) {
    deps.out({ line: JSON.stringify({ disagreements }) });
    return disagreements.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  if (operations.length === 0 && requests.length === 0) {
    deps.out({
      line: "the github atlas holds no operations and no observed requests — run `slopweaver atlas github sync`, then `walk`",
    });
    return EXIT_EXPECTED_EMPTY;
  }
  for (const line of renderDisagreements({ disagreements })) {
    deps.out({ line });
  }
  return disagreements.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Run the GitHub corroboration report against injected edges.
 *
 * @param argv the whole process argv
 * @param deps where the generation is read from and where the lines go
 * @returns `EXIT_OK` when a disagreement was printed, `EXIT_EXPECTED_EMPTY` when there was none to print,
 *   `EXIT_USAGE` for a refused tail, `EXIT_ERROR` when the generation could not be read
 */
export function runGithubAtlasReport({ argv, deps }: { argv: readonly string[]; deps: GithubAtlasReportDeps }): number {
  const parsed = parseFlagTail({
    rest: verbTail({ argv, at: VERB_DEPTH, verbs: ["report"] }),
    spec: { boolean: ["json"], value: ["home"] },
  });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.error({ msg: line });
    }
    deps.error({ msg: GITHUB_REPORT_USAGE });
    return EXIT_USAGE;
  }
  return runReport({ deps, flags: parsed.value.flags, values: parsed.value.values });
}

/** `slopweaver atlas github report` — the corroboration output, resolving nothing. */
export const githubAtlasReportCommand = defineCommand({
  run: (argv: readonly string[]): number =>
    runGithubAtlasReport({
      argv,
      deps: {
        error: ({ msg }) => {
          process.stderr.write(`${msg}\n`);
        },
        out: ({ line }) => {
          logger.out({ line });
        },
        readAtlas: readGithubAtlas,
      },
    }),
});
