/**
 * `slopweaver github stack audit` — the effectful shell over `./stackAuditCore.ts`'s pure relation.
 *
 * One read, repo-wide: the open pull requests one capped page walk returns, each carrying its own native stack
 * membership inline (measured — see `listOpenPrsVia`'s own note), so no candidate is re-read to learn whether
 * it is stacked. The walk stops at `listOpenPrsVia`'s page cap and reports that in `truncated`, which this
 * verb prints and which FAILS `--check`: a cut-short walk is never certified clean. Nothing here is written, and nothing is
 * retargeted or adopted: this verb REPORTS, and the doors and `stack adopt` repair. That separation is
 * deliberate — the violations in a busy repository are mostly other people's pull requests, and rewriting
 * somebody else's branch topology is not this installation's call to make.
 *
 * `--check` is what makes it a gate rather than a report: it exits non-zero on any surviving violation, so
 * CI can fail a pull request opened into a chain nothing registered. That is the half of the fix a session
 * cannot route around by not running the verb.
 */

import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { githubVerbErrorLines } from "./errors.js";
import {
  type AuditPr,
  auditPrOf,
  type ChainViolation,
  chainViolationsIn,
  githubStackAuditReportLines,
  parseGithubStackAuditArgs,
  stackAuditExitCode,
} from "./stackAuditCore.js";

/** Where this verb's own arguments start: after node, the script, "github", "stack" and "audit". */
const VERB_ARG_OFFSET = 5;

/** The injectable edges — the API factory, the token resolver and the output sink. */
export interface GithubStackAuditDeps {
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly out: (input: { readonly line: string }) => void;
  readonly token: (input: { readonly home: string }) => string | undefined;
}

/**
 * The production edges.
 *
 * @internal the default parameter of {@link runGithubStackAudit}; no other module builds them.
 * @returns the real API factory, token resolver and output sink
 */
export function productionGithubStackAuditDeps(): GithubStackAuditDeps {
  return {
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    out: logger.out,
    token: ({ home }) => githubToken({ home }),
  };
}

/** One side's native stack as `--json` reports it: JSON `null` for a pull request in no stack. */
function reportedStack({ side }: { side: AuditPr }): number | null {
  const stackNumber = side.stackNumber;
  if (stackNumber === undefined) {
    return null;
  }
  return stackNumber;
}

/** One violation as the JSON document `--json` emits, flat enough to filter with `jq` in one expression. */
function jsonEntryOf({ violation }: { violation: ChainViolation }): Record<string, unknown> {
  return {
    child: violation.child.number,
    childBranch: violation.child.headRef,
    childStack: reportedStack({ side: violation.child }),
    kind: violation.kind,
    parent: violation.parent.number,
    parentBranch: violation.parent.headRef,
    parentStack: reportedStack({ side: violation.parent }),
    url: violation.child.htmlUrl,
    yours: violation.child.yours || violation.parent.yours,
  };
}

/**
 * Read the open pull requests the capped list walk returns and project them, or the line explaining why the
 * read did not happen. The walk's `truncated` flag is carried, never dropped: a cut-short list fails `--check`.
 */
async function auditFacts({
  api,
  owner,
  repo,
}: {
  api: GithubWriteApi;
  owner: string;
  repo: string;
}): Promise<{ readonly prs: readonly AuditPr[]; readonly truncated: boolean } | { readonly refusal: string }> {
  const listed = await api.listOpenPrs({ owner, repo });
  if (listed.isErr()) {
    return { refusal: `refused: could not list ${owner}/${repo}'s open pull requests: ${listed.error.message}` };
  }
  const { prs, truncated, viewerId } = listed.value;
  return { prs: prs.map((pr) => auditPrOf({ pr, viewerId })), truncated };
}

/**
 * Run one repository-wide chained-stack audit.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github", "stack", "audit"
 * @param deps the injectable API, token and output edges
 * @returns the process exit code — non-zero on a surviving violation only when `--check` was passed
 */
export async function runGithubStackAudit({
  argv,
  deps = productionGithubStackAuditDeps(),
}: {
  argv: readonly string[];
  deps?: GithubStackAuditDeps;
}): Promise<number> {
  const parsed = parseGithubStackAuditArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) deps.out({ line });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return EXIT_ERROR;
  }
  const facts = await auditFacts({ api: deps.makeApi({ home, token }), owner: args.owner, repo: args.repo });
  if ("refusal" in facts) {
    deps.out({ line: facts.refusal });
    return EXIT_ERROR;
  }
  const all = chainViolationsIn({ openPrs: facts.prs });
  const violations = args.mine ? all.filter((violation) => violation.child.yours || violation.parent.yours) : all;
  const slug = `${args.owner}/${args.repo}`;
  if (args.json) {
    const document = {
      openPullRequests: facts.prs.length,
      repo: slug,
      truncated: facts.truncated,
      violations: violations.map((violation) => jsonEntryOf({ violation })),
    };
    deps.out({ line: safeJsonStringify({ label: "github stack audit", value: document }) });
  } else {
    const lines = githubStackAuditReportLines({
      openPrCount: facts.prs.length,
      repo: slug,
      truncated: facts.truncated,
      violations,
    });
    for (const line of lines) {
      deps.out({ line });
    }
  }
  return stackAuditExitCode({ check: args.check, truncated: facts.truncated, violationCount: violations.length });
}

/**
 * The registered command.
 *
 * @internal the manifest loads it by name; nothing imports it.
 */
export const githubStackAuditCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubStackAudit({ argv }),
});
