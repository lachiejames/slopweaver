/**
 * The ARTIFACT half of the admit hook: refuse a call of the `Artifact` tool, and name where a page goes now.
 *
 * ## Why this exists
 *
 * It is impossible to publish a Claude artifact. Every session that
 * would end in one artifact the owner reacts to ends in a LOCAL page instead, at
 * `$SLOPWEAVER_HOME/pages/<slug>/index.html`, written by `slopweaver page publish`. Two things enforce that
 * and they are not the same mechanism: a deny rule in the owner's user-level Claude Code settings, which every
 * session on this machine inherits and which refuses with the host's own wording; and this walk, which
 * refuses with a reason and a hatch, so the block says WHY and hands over the verb that replaces it. A block
 * that does not say why is not helpful to the agent, and the deny rule alone is exactly that block.
 *
 * ## Why it is a separate walk rather than a branch of the shell ones
 *
 * `./hookPayload.ts`'s `shellCallOf` answers `{block: false}` for any tool that is not `Bash` or `Monitor`,
 * BEFORE either shell classifier runs — so a third classifier added below that return would never see an
 * `Artifact` payload at all. This one is asked FIRST, on the payload rather than on a command line, and its
 * hatch is its own: `SLOPWEAVER_ALLOW_RAW` and `SLOPWEAVER_ALLOW_PYTHON` never open it, and
 * `SLOPWEAVER_ALLOW_ARTIFACT` never opens either of them. Opening one hatch must never waive a policy the
 * caller did not think about, which is the same reason the raw and Python walks are independent of each
 * other.
 *
 * ## What it judges, and what it deliberately does not
 *
 * The TOOL, not the action. Every `Artifact` call is refused — a `read`, a `list`, a `comments` read as much
 * as a `publish` — because this is a rule about which surface a page lives on, and a session that can still
 * read its gallery is a session that will keep treating the gallery as the place pages go. The exceptions
 * that are legitimate are on the hatch's own row, where they are visible, rather than encoded here as an
 * action allowlist nobody reads.
 *
 * ## The hatch is SESSION-SCOPED, and that is a real limit rather than an oversight
 *
 * `./pythonInvocation.ts`'s hatch can be typed inline on the one re-run, because its subject is a command
 * line and the walk reads a per-segment `NAME=1` prefix off it. There is no command line here, so
 * `SLOPWEAVER_ALLOW_ARTIFACT=1` is only readable where the hook process gets its environment — at session
 * launch. A session already running cannot open it for itself.
 *
 * That is deliberate: the intended way past this refusal is not the hatch at all, it is `slopweaver page publish`, which
 * the refusal names. A hatch whose path of least resistance is the correct act is the arrangement the owner wants. The hatch stays for the one case that verb cannot serve — reading a page published before
 * this ruling, whose only copy is the gallery — and that case is worth a session relaunch.
 *
 * ## What it cannot see, stated
 *
 * A publish performed by something other than this tool — a session on another host, a script driving the
 * web app, a browser leg. **A refusal confirms you were about to publish an artifact; its absence proves
 * nothing**, which is the same property `AGENTS.md` rule 3 states about every tripwire here.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { isRecord } from "../lib/parsers.js";

/** The variable that opens this walk's hatch. */
export const ARTIFACT_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_ARTIFACT";

/** The tool this walk refuses, matched exactly. */
const ARTIFACT_TOOL = "Artifact";

/** The walk's decision. A block always carries the rendered four-line refusal. */
export type ArtifactVerdict = { readonly blocked: true; readonly message: string } | { readonly blocked: false };

/**
 * Decide whether one tool-call payload is an `Artifact` call, and refuse it unless the hatch is open.
 *
 * Anything that is not an object, or whose `tool_name` is not exactly `Artifact`, is allowed HERE — this
 * walk answers one question and the malformed-payload fail-closed decision stays with `./hookPayload.ts`,
 * which is the only place it can be made once for every tool.
 *
 * @param payload the parsed PreToolUse JSON
 * @param allowArtifact whether `SLOPWEAVER_ALLOW_ARTIFACT=1` is set in the hook's own environment
 * @returns a block carrying the rendered refusal, or an allow
 */
export function classifyArtifactTool({
  payload,
  allowArtifact,
}: {
  payload: unknown;
  allowArtifact: boolean;
}): ArtifactVerdict {
  if (allowArtifact || !isRecord(payload) || payload["tool_name"] !== ARTIFACT_TOOL) {
    return { blocked: false };
  }
  return {
    blocked: true,
    message: hatchRefusal({
      detail:
        "publish the page with `slopweaver page publish <slug> --page <html> --review <id>` (the review from " +
        "`slopweaver page review-prepare`) and give the owner that address",
      hatch: hatchFor({ id: "artifact" }),
    }),
  };
}
