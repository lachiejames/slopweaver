/**
 * Effectful shell for the governed GitHub base-retarget write.
 *
 * The order matches every other write in this directory: parse → token → read the pull request and settle
 * authorisation → decide from the live shape (refuse/no-op/proceed) → [dry-run stops here] → door → re-read
 * for freshness → PATCH the base → read back → confirm the base actually changed → report.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { err } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import type { GithubPrDeps } from "./prDeps.js";
import { GITHUB_PR_RETARGET_USAGE } from "./prUsage.js";
import {
  type GithubPrRetargetArgs,
  parseGithubPrRetargetArgs,
  retargetDecisionFor,
  retargetDoorRequest,
  retargetFreshnessFor,
} from "./retargetCore.js";
import { type AuditPr, auditPrOf, chainDoorRefusalLines, chainParentFor } from "./stackAuditCore.js";
import { registerAgainstParent, stackRegistrationFailed, stackRegistrationLines } from "./stackRegistration.js";
import { ALLOW_FOREIGN_PR, authorisationFor } from "./updateCore.js";

/**
 * The open pull request whose head branch is the requested base, when there is one.
 *
 * A failed listing is a REFUSAL rather than an empty answer: this gate exists to make a chain GitHub cannot
 * see impossible, and a gate that fails open on a transport error is exactly the shape that lets the class
 * back in on the one lap the network was slow.
 *
 * @returns the parent, `undefined` when the base is nobody's open head, or the line to refuse with
 */
async function chainParentOf({
  api,
  args,
  previewed,
}: {
  api: GithubWriteApi;
  args: GithubPrRetargetArgs;
  previewed: WrittenPr;
}): Promise<{ readonly parent: AuditPr | undefined } | { readonly refusal: string }> {
  const listed = await api.listOpenPrs({ owner: args.owner, repo: args.repo });
  if (listed.isErr()) {
    return {
      refusal:
        `refused: could not read ${args.owner}/${args.repo}'s open pull requests to check whether ` +
        `${args.base} is one of their head branches: ${listed.error.message}`,
    };
  }
  const openPrs = listed.value.prs.map((pr) => auditPrOf({ pr, viewerId: listed.value.viewerId }));
  return {
    parent: chainParentFor({
      baseRef: args.base,
      baseRepoFullName: previewed.baseRepoFullName,
      excludeNumber: previewed.number,
      openPrs,
    }),
  };
}

/**
 * The whole chained-base gate: read the base's own open pull request, and refuse unless `--adopt` was passed.
 *
 * Its own function rather than four branches inside the verb, because the verb is already at the complexity
 * ceiling and this is the one block of it that is a single decision.
 *
 * @param api the GitHub write surface
 * @param args the parsed invocation
 * @param deps the injectable output sinks
 * @param previewed the pull request as read for the decision
 * @returns the resolved parent to register against, or that the caller must refuse
 */
async function chainGate({
  api,
  args,
  deps,
  previewed,
}: {
  api: GithubWriteApi;
  args: GithubPrRetargetArgs;
  deps: GithubPrDeps;
  previewed: WrittenPr;
}): Promise<{ readonly kind: "clear"; readonly parent: AuditPr | undefined } | { readonly kind: "refused" }> {
  const chained = await chainParentOf({ api, args, previewed });
  if ("refusal" in chained) {
    deps.err({ line: chained.refusal });
    return { kind: "refused" };
  }
  if (chained.parent === undefined || args.adopt) {
    return { kind: "clear", parent: chained.parent };
  }
  for (const line of chainDoorRefusalLines({
    base: args.base,
    parent: chained.parent,
    verb: `retargeting #${String(args.number)} onto ${args.base}`,
  })) {
    deps.err({ line });
  }
  deps.err({
    line:
      "  Pass --adopt to retarget AND register the stack membership in this one invocation, which is the " +
      "only order that never leaves the chain visible.",
  });
  return { kind: "refused" };
}

/** Convert a neverthrow provider result into the command's small ordinary Result. */
async function readPr({
  api,
  args,
}: {
  api: GithubWriteApi;
  args: GithubPrRetargetArgs;
}): Promise<GithubVerbResult<WrittenPr>> {
  const { owner, repo, number } = args;
  const read = await api.getPr({ number, owner, repo });
  return read.mapErr((error) => GithubVerbErrors.prUnread({ cause: error.message, number, owner, repo }));
}

/**
 * Read the pull request and settle whether this caller may retarget it.
 *
 * @returns the pull request as read, or undefined once the read or authorisation refusal has been printed
 */
async function authorisePr({
  api,
  args,
  deps,
}: {
  api: GithubWriteApi;
  args: GithubPrRetargetArgs;
  deps: GithubPrDeps;
}): Promise<WrittenPr | undefined> {
  const previewed = await readPr({ api, args });
  if (previewed.isErr()) {
    for (const line of githubVerbErrorLines({ error: previewed.error })) {
      deps.err({ line });
    }
    return undefined;
  }
  const identity = await api.authenticatedUserId();
  const authorised = authorisationFor({
    allowForeign: deps.env({ name: ALLOW_FOREIGN_PR }) === "1",
    authedUserId: identity.isOk() ? identity.value : undefined,
    prAuthorId: previewed.value.authorId,
    purpose: "retarget",
  });
  if (authorised.kind === "refused") {
    deps.err({ line: authorised.reason });
    return undefined;
  }
  if (authorised.kind === "overridden") {
    deps.out({ line: authorised.notice });
  }
  return previewed.value;
}

/** Re-read for freshness, send the base once, and confirm it landed by a fresh read-back. */
async function retargetAndConfirm({
  api,
  args,
  previewed,
}: {
  api: GithubWriteApi;
  args: GithubPrRetargetArgs;
  previewed: WrittenPr;
}): Promise<GithubVerbResult<WrittenPr>> {
  const current = await readPr({ api, args });
  if (current.isErr()) {
    return current;
  }
  const freshness = retargetFreshnessFor({ current: current.value, previewed });
  if (!freshness.fresh) {
    return err(GithubVerbErrors.factRefused({ reason: freshness.reason, subject: `#${String(args.number)}` }));
  }
  const written = await api.updatePr({ base: args.base, number: args.number, owner: args.owner, repo: args.repo });
  if (written.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "retarget", reasons: [written.error.message] }));
  }
  const after = await readPr({ api, args });
  if (after.isErr()) {
    return after;
  }
  const { base: expected, number } = args;
  const observed = after.value.baseRef;
  return observed === expected ? after : err(GithubVerbErrors.retargetUnconfirmed({ expected, number, observed }));
}

/** Print one result in the selected output mode — `outcome` is a short verb phrase, never a full sentence. */
function report({
  deps,
  args,
  pr,
  outcome,
}: {
  deps: GithubPrDeps;
  args: GithubPrRetargetArgs;
  pr: WrittenPr;
  outcome: string;
}): void {
  deps.out({
    line: args.json
      ? JSON.stringify({ base: pr.baseRef, outcome, pullRequest: pr }, undefined, 2)
      : `${outcome} #${String(pr.number)} -> ${pr.baseRef}  ${pr.htmlUrl}`,
  });
}

/** Print a plain-sentence outcome — the no-op and refusal shapes, which already read as complete sentences. */
function reportSentence({
  deps,
  args,
  pr,
  sentence,
}: {
  deps: GithubPrDeps;
  args: GithubPrRetargetArgs;
  pr: WrittenPr;
  sentence: string;
}): void {
  deps.out({
    line: args.json
      ? JSON.stringify({ base: pr.baseRef, outcome: sentence, pullRequest: pr }, undefined, 2)
      : `${sentence}  ${pr.htmlUrl}`,
  });
}

/**
 * Send the write through the door, report the confirmed or refused outcome, and — when the new base is
 * another open pull request's head — register the native stack membership before reporting success.
 *
 * The registration is deliberately NOT inside the door's `perform`: the door records ONE external write and
 * this is a second one, and a stack create that failed after a base that landed is a state the caller has to
 * be told about explicitly rather than have folded into a single refusal. A failure here is still non-zero,
 * so it can never read as a clean retarget.
 */
async function performWrite({
  api,
  args,
  home,
  parent,
  previewed,
  deps,
}: {
  api: GithubWriteApi;
  args: GithubPrRetargetArgs;
  home: string;
  parent: AuditPr | undefined;
  previewed: WrittenPr;
  deps: GithubPrDeps;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => retargetAndConfirm({ api, args, previewed }),
    request: retargetDoorRequest({ args, home }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({ command: "slopweaver github pr retarget", through });
    for (const line of refusal) deps.err({ line });
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    for (const line of githubVerbErrorLines({ error: through.result.error })) deps.err({ line });
    return EXIT_ERROR;
  }
  report({ args, deps, outcome: "retargeted", pr: through.result.value });
  if (parent === undefined) {
    return EXIT_OK;
  }
  const registration = await registerAgainstParent({
    api,
    base: args.base,
    owner: args.owner,
    parentPr: { number: parent.number, stackNumber: parent.stackNumber },
    prNumber: args.number,
    repo: args.repo,
  });
  if (stackRegistrationFailed({ registration })) {
    for (const line of stackRegistrationLines({ registration })) {
      deps.err({ line });
    }
    deps.err({
      line:
        `refused to report success: #${String(args.number)} now targets ${args.base} but was NOT registered ` +
        `into a native GitHub stack. Confirm the repair with ` +
        `\`slopweaver github stack audit --repo ${args.owner}/${args.repo} --check\`.`,
    });
    return EXIT_ERROR;
  }
  for (const line of stackRegistrationLines({ registration })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run the base retarget.
 *
 * @param rest argv after `github pr retarget`
 * @param deps the shared `github pr` injectable edges — token, API factory, output and diagnostic sinks
 * @returns the process exit code
 */
export async function runGithubPrRetarget({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubPrDeps;
}): Promise<number> {
  const parsed = parseGithubPrRetargetArgs({ rest });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.err({ line });
    }
    deps.err({ line: GITHUB_PR_RETARGET_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });

  const token = deps.token({ home });
  if (token === undefined) {
    deps.err({ line: "no GitHub token configured; run `slopweaver connect github`" });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });

  const previewed = await authorisePr({ api, args, deps });
  if (previewed === undefined) {
    return EXIT_ERROR;
  }

  const decision = retargetDecisionFor({ pr: previewed, requestedBase: args.base });
  if (decision.kind === "refused") {
    deps.err({ line: decision.reason });
    return EXIT_ERROR;
  }
  if (decision.kind === "noop") {
    reportSentence({ args, deps, pr: previewed, sentence: decision.reason });
    return EXIT_OK;
  }
  const chained = await chainGate({ api, args, deps, previewed });
  if (chained.kind === "refused") {
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    report({ args, deps, outcome: "would retarget", pr: { ...previewed, baseRef: args.base } });
    if (chained.parent !== undefined) {
      deps.out({
        line: `dry run: would then register #${String(args.number)} against #${String(chained.parent.number)}'s native stack`,
      });
    }
    deps.out({ line: "dry run: a token was resolved and the pull request was READ; no door record, no PATCH." });
    return EXIT_OK;
  }

  return performWrite({ api, args, deps, home, parent: chained.parent, previewed });
}
