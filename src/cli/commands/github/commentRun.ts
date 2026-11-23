/**
 * `slopweaver github comment` — the effectful shell. Every decision lives in `./commentCore.ts`; this file
 * resolves the home and token, reads stdin, runs the above-the-fold gate, and routes the write through the
 * admit door.
 *
 * Create and edit are both single, no-retry mutations reported success only after a read-back — the same
 * shape `./threadRun.ts`'s `reply`/`resolve` use, and for the same reason: GitHub issues no caller-chosen id
 * for either a comment or a thread reply, so there is nothing local to reserve before sending. A lost
 * response here is reported as a failure to read the confirmation, not silently retried.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { githubCommentAboveFoldCells } from "../../../outbound/github/aboveFold.js";
import { bareRefIssuesOfCommentArtifact, linkifyCommentArtifact } from "../../../outbound/github/bareRefLinks.js";
import { renderCommentBody } from "../../../outbound/github/commentRender.js";
import { type GithubCommentApi, makeGithubCommentApi, type WrittenComment } from "../../../outbound/github/comments.js";
import type { GithubCommentArtifact } from "../../../outbound/github/commentTypes.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { aboveFoldGateRefused } from "../../aboveFoldDoor.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import {
  commentDoorRequestFor,
  commentDryRunLines,
  type GithubCommentArgs,
  parseGithubCommentArgs,
  parseGithubCommentForm,
} from "./commentCore.js";
import { type GithubVerbError, githubVerbErrorLines } from "./errors.js";
import { GITHUB_COMMENT_USAGE } from "./prUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubCommentDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubCommentApi;
  readonly readStdin: () => Promise<string>;
  readonly env: (args: { name: string }) => string | undefined;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubCommentArgs; deps: GithubCommentDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/** Read the form, taking `-` from stdin the way every other form-carrying verb does. */
async function formRaw({ deps, source }: { deps: GithubCommentDeps; source: string }): Promise<string> {
  return source === "-" ? deps.readStdin() : source;
}

/** Report the written comment in the selected output mode. */
function report({
  deps,
  args,
  comment,
  outcome,
}: {
  deps: GithubCommentDeps;
  args: GithubCommentArgs;
  comment: WrittenComment;
  outcome: string;
}): void {
  if (args.json) {
    deps.out(JSON.stringify({ id: comment.id, outcome, url: comment.htmlUrl }, undefined, 2));
    return;
  }
  deps.out(`${outcome}  ${String(comment.id)}  ${comment.htmlUrl}`);
}

/** Send the one write through the door, then confirm it with a separate read-back. */
async function sendComment({
  deps,
  args,
  home,
  api,
  body,
}: {
  deps: GithubCommentDeps;
  args: GithubCommentArgs;
  home: string;
  api: GithubCommentApi;
  body: string;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: async () => {
      const written =
        args.subVerb === "create"
          ? await api.create({ body, number: args.number, owner: args.owner, repo: args.repo })
          : await api.edit({ body, commentId: args.commentId, owner: args.owner, repo: args.repo });
      if (written.isErr()) {
        return err([written.error.message]);
      }
      const readBack = await api.read({ commentId: written.value.id, owner: args.owner, repo: args.repo });
      return readBack.isErr() ? err([readBack.error.message]) : ok(readBack.value);
    },
    request: commentDoorRequestFor({ args, home }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({
      command: `slopweaver github comment ${args.subVerb}`,
      through,
    });
    for (const line of refusal) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    through.result.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  report({ args, comment: through.result.value, deps, outcome: args.subVerb === "create" ? "posted" : "edited" });
  return EXIT_OK;
}

/** The above-the-fold gate on the comment's summary. */
async function aboveFoldRefused({
  args,
  artifact,
  deps,
}: {
  args: GithubCommentArgs;
  artifact: GithubCommentArtifact;
  deps: GithubCommentDeps;
}): Promise<boolean> {
  return aboveFoldGateRefused({
    surface: "github",
    // A GitHub top-level comment is its summary and nothing else, so it has no fold.
    belowFoldCells: [],
    cells: githubCommentAboveFoldCells({ artifact }),
    dryRun: args.dryRun,
    env: deps.env,
    home: stateHomeOf({ args, deps }),
    ledger: deps.doorLedger,
    out: ({ line }) => {
      deps.out(line);
    },
  });
}

/**
 * The bare-reference context for this comment: the destination repo `--owner`/`--repo` named directly, plus
 * the number of the object being commented on as magnitude evidence — a comment on a low-numbered pull request cannot plausibly
 * cite that same repo's far larger number. See `../../../outbound/linkify/bareRefs.ts`'s "a number that CANNOT be one
 * of this repo's own" section.
 */
function bareRefContextOf({ args }: { args: GithubCommentArgs }): BareRefContext {
  const target = { owner: args.owner, repo: args.repo };
  // `edit` addresses a comment id rather than the object it hangs off, so it carries no number to attest.
  const attested = args.subVerb === "create" ? [{ ...target, number: args.number }] : [];
  return { attested, repos: [target] };
}

/**
 * Resolve every bare `#N`, `owner/repo#N` and `SUP-N` reference into a real link, then refuse whatever still can't
 * resolve — same rule the pull-request forms enforce, see `./bareRefFlow.ts`.
 */
function bareRefRefused({
  args,
  artifact,
  deps,
  home,
}: {
  args: GithubCommentArgs;
  artifact: GithubCommentArtifact;
  deps: GithubCommentDeps;
  home: string;
}): boolean {
  const context = bareRefContextOf({ args });
  const issues = bareRefIssuesOfCommentArtifact({ artifact, context }).map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
  return bareRefGateRefused({
    dryRun: args.dryRun,
    env: deps.env,
    home,
    issues,
    out: ({ line }) => {
      deps.out(line);
    },
  });
}

/** Read and validate the form. Shared by `--dry-run` and the live path. */
async function readForm({
  deps,
  args,
}: {
  deps: GithubCommentDeps;
  args: GithubCommentArgs;
}): Promise<Result<GithubCommentArtifact, GithubVerbError>> {
  const raw = await formRaw({ deps, source: args.formSource });
  return parseGithubCommentForm({ raw });
}

/**
 * Run the comment operation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "comment"
 * @param deps credential, client, stdin and output seams
 * @returns the process exit code
 */
export async function runGithubComment({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubCommentDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest: argv.slice(VERB_ARG_OFFSET), verb: "comment" });
  if (gated !== undefined) {
    return gated;
  }
  return commentPass({ argv, deps });
}

/** One `github comment` pass, past the ruling gate {@link runGithubComment} asks first. */
async function commentPass({ argv, deps }: { argv: readonly string[]; deps: GithubCommentDeps }): Promise<number> {
  const parsed = parseGithubCommentArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_COMMENT_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const parsedForm = await readForm({ args, deps });
  if (parsedForm.isErr()) {
    githubVerbErrorLines({ error: parsedForm.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_USAGE;
  }
  // Resolve every bare #N, owner/repo#N and SUP-N reference into a real link before anything renders — see
  // ./bareRefFlow.ts's sibling rule for the pull-request forms.
  const artifact = linkifyCommentArtifact({ artifact: parsedForm.value, context: bareRefContextOf({ args }) });
  const home = stateHomeOf({ args, deps });
  if (args.dryRun) {
    for (const line of commentDryRunLines({ args, artifact })) {
      deps.out(line);
    }
    const aboveFold = await aboveFoldRefused({ args, artifact, deps });
    const bareRefs = bareRefRefused({ args, artifact, deps, home });
    return aboveFold || bareRefs ? EXIT_ERROR : EXIT_OK;
  }
  if (await aboveFoldRefused({ args, artifact, deps })) {
    return EXIT_ERROR;
  }
  if (bareRefRefused({ args, artifact, deps, home })) {
    return EXIT_ERROR;
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  return sendComment({
    api: deps.makeApi({ home, token }),
    args,
    body: renderCommentBody({ artifact }),
    deps,
    home,
  });
}

/**
 * Production GitHub, stdin and output seams.
 *
 * @returns credential, sanctioned write-client, stdin and output edges for the comment command
 */
export function productionGithubCommentDeps(): GithubCommentDeps {
  return {
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubCommentApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github comment`. */
export const githubCommentCommand = defineCommand({
  run: (argv) => runGithubComment({ argv, deps: productionGithubCommentDeps() }),
});
