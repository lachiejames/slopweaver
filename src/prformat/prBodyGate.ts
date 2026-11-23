/**
 * The pull-request body gate CI runs: this repository's own pull request is accepted only as the exact C3 render,
 * and anyone else's is judged by the security scans alone.
 *
 * - **Owned** — opened from a branch of this repository by an author whose body this repository writes. The body
 *   must parse as C3 (`src/outbound/github/parse.ts`), which re-renders it byte for byte, and pass the C3 form rules
 *   of the layout it is in (word caps, badges, hosting, and for the current layout the content rules over the title
 *   and body, `src/outbound/github/descriptionWords.ts`), the invented-visual check and the Datadog host check. A
 *   body in an earlier layout is held to that layout's rules, so a description is never retroactively refused. A published grade, gold anchor or origin line is refused: none is published any
 *   more (`AGENTS.md` rule 7). A pre-C3 body is refused naming the conversion, which writes an authoring file and
 *   sends nothing. When the CI event carries the title and labels, a missing kind label is refused too.
 * - **Stranger** — a fork, a Renovate bot whose body is generated from its own config, or a GitHub App nothing here
 *   names. No description rule applies: a stranger cannot be made to write C3. Only the hygiene and secret scans run,
 *   and those run in the caller over the title and the body (`scanPrMetadataLeaks`), not here.
 *
 * There is no receipt in CI: what a description review recorded is local state CI cannot see.
 */
import type { DependencyBotActors } from "../organisation/dependencyBots.js";
import { descriptionShapeOf } from "../outbound/github/bodyMarkers.js";
import { withholdingCredentialLines } from "../outbound/github/descriptionWords.js";
import { PRE_C3_CONVERSION } from "../outbound/github/errors.js";
import { c3FormErrors } from "../outbound/github/formRules.js";
import { missingKindLabels } from "../outbound/github/kindLabels.js";
import { parsePrBody } from "../outbound/github/parse.js";
import { inventedVisualErrors } from "./checkCore.js";
import { invalidDatadogHostErrors } from "./invalidDatadogHost.js";

/**
 * Which shape the gate read a body as: the C3 shape, a pre-C3 one, neither, or a stranger's (not judged).
 *
 * @internal — named only through {@link PrBodyGateResult}'s `shape` field
 */
export type PrBodyShape = "c3" | "pre-c3" | "unknown" | "stranger";

/** The gate's verdict: the shape it detected and every error it found. Empty errors means the body conforms. */
export interface PrBodyGateResult {
  readonly shape: PrBodyShape;
  readonly errors: readonly string[];
}

/** Where the shape a description should take is written down. */
const TEMPLATE = ".github/pull_request_template.md";

/**
 * The STRUCTURES a pre-C3 body published a grade, gold anchor or origin through: the hidden review comment, the
 * anchor's own lines and an origin line. Matched as structures, never as phrases: a C3 explainer may well SAY
 * "gold anchor" or "graded gold" (this change's own description does), and the C3 form has no field a grade could
 * ride in, so prose about grades is prose. Installation state in prose is the publication scan's refusal, not this.
 */
const RETIRED_PUBLICATIONS: readonly { readonly found: (body: string) => boolean; readonly what: string }[] = [
  { found: (body) => /<!--\s*slopweaver-review\b/i.test(body), what: "a proof grade" },
  {
    found: (body) => bareLinesOf({ body }).some((line) => /^proof-(?:commit|patch-id)\s*:/i.test(line)),
    what: "a gold anchor",
  },
  { found: (body) => bareLinesOf({ body }).some((line) => /^origin\s*[:|]/i.test(line)), what: "an origin line" },
];

/**
 * Every line with its wrapping markup taken off — tags (`<p><strong>`), emphasis and code marks (`**`, `_`, a
 * backtick) and a leading quote or list marker — so `**proof-commit:**` is the anchor line it renders as. Separate
 * cheap steps rather than one pattern: a tag run and the whitespace around it, quantified side by side, backtrack
 * polynomially.
 */
function bareLinesOf({ body }: { body: string }): readonly string[] {
  return body.split("\n").map((line) =>
    line
      .replace(/<[^>]*>/g, "")
      .replace(/[*_`]/g, "")
      .replace(/^[\s>+-]*/, ""),
  );
}

/**
 * Every published grade, anchor or origin line in a body.
 *
 * @param body the description, LF-normalised
 * @returns one refusal per kind found, naming what to remove
 */
export function retiredPublicationErrors({ body }: { body: string }): readonly string[] {
  const kinds = [...new Set(RETIRED_PUBLICATIONS.filter(({ found }) => found(body)).map(({ what }) => what))];
  return kinds.map(
    (what) => `RETIRED_PUBLICATION: the description publishes ${what}, which a C3 description never carries. Remove it`,
  );
}

/** The refusals a pre-C3 or unrecognised owned body earns, naming the way forward. */
function shapeRefusal({ body }: { body: string }): PrBodyGateResult | undefined {
  const shape = descriptionShapeOf({ text: body });
  if (shape === "reading-order" || shape === "retired-table") {
    return {
      errors: [
        `PRE_C3_SHAPE: the description is a pre-C3 ${shape} body. Convert it, which writes an authoring file and ` +
          `sends nothing: \`${PRE_C3_CONVERSION}\`.`,
      ],
      shape: "pre-c3",
    };
  }
  if (shape === "none") {
    return {
      errors: [
        `The description is not a C3 body. Write it in the shape ${TEMPLATE} describes, through ` +
          "`slopweaver github stack push --file <f>` or `slopweaver github pr update <n> --file <f>`.",
      ],
      shape: "unknown",
    };
  }
  return undefined;
}

/**
 * Judge a pull-request body.
 *
 * @param body the PR description markdown, as the CI event carries it
 * @param owned whether this is this repository's own pull request (see {@link prOwnership}); a stranger's body is
 *   not judged here
 * @param title the pull request's title, from the CI event; with `labels`, what the kind-label check derives from
 * @param labels the labels the pull request carries, from the CI event; absent, the kind-label check does not run
 * @returns the detected shape and every error; empty errors means the body conforms. A line that would quote a
 *   credential shape (a recovered run in the parse refusal, an embed's address) prints the withheld line instead,
 *   since CI prints these lines to its log
 */
export function gatePrBody({
  body,
  owned,
  title,
  labels,
}: {
  body: string;
  owned: boolean;
  title?: string;
  labels?: readonly string[];
}): PrBodyGateResult {
  if (!owned) {
    return { errors: [], shape: "stranger" };
  }
  // GitHub's web editor stores CRLF; the renderer writes LF. Judging the content, not the line endings.
  const normalised = body.replace(/\r\n/g, "\n");
  const refused = shapeRefusal({ body: normalised });
  if (refused !== undefined) {
    return { ...refused, errors: withholdingCredentialLines({ lines: refused.errors }) };
  }
  const retired = [
    ...retiredPublicationErrors({ body: normalised }),
    ...inventedVisualErrors({ body: normalised }),
    ...invalidDatadogHostErrors({ body: normalised }),
  ];
  const labelErrors =
    title === undefined || labels === undefined
      ? []
      : missingKindLabels({ labels, title }).map(
          (label) =>
            `KIND_LABEL_MISSING: the title's kind derives the label "${label}", which the pull request does not ` +
            "carry. `slopweaver github pr update <n>` applies the derived labels",
        );
  const parsed = parsePrBody({ body: normalised });
  if (parsed.isErr()) {
    return {
      errors: withholdingCredentialLines({
        lines: [`The description is not a canonical C3 body: ${parsed.error.message}.`, ...retired, ...labelErrors],
      }),
      shape: "c3",
    };
  }
  // A body is judged by the rules of the layout it was published in, so one written before a rule never turns red.
  const { body: read, layout } = parsed.value;
  const rules = c3FormErrors({ body: read, layout, title, today: undefined }).map(
    (issue) => `${issue.path.join(".")}: ${issue.code}: ${issue.message}`,
  );
  return { errors: withholdingCredentialLines({ lines: [...rules, ...retired, ...labelErrors] }), shape: "c3" };
}

/**
 * Whether a pull request is this repository's own, from the CI event's facts.
 *
 * A stranger is a fork (its head repository is not the base), a Renovate bot (its body comes from `renovate.json`),
 * or a GitHub App nothing here names. Dependabot is named and is NOT Renovate, so its pull request stays owned and
 * red until `github bump-drive` rewrites its body as C3. Run locally, with no CI event, every body is owned: the
 * check is of a description this checkout is about to publish.
 *
 * The Renovate bots are `bots.renovateRestLogins`, spelled as `$PR_AUTHOR` carries them: the CI event's REST
 * `user.login`, where a GitHub App ends `[bot]`. A bare login with no `[bot]` is a USER of that name and is owned.
 *
 * @param author the pull request's author login, from `$PR_AUTHOR`
 * @param authorType the author's GitHub account type, from `$PR_AUTHOR_TYPE` (`Bot` for an App)
 * @param headRepository the head branch's `owner/repo`, from `$PR_HEAD_REPOSITORY`
 * @param ownRepository the base `owner/repo`, from `$PR_REPOSITORY`
 * @param bots the dependency-bot identities this install recognises
 * @returns `owned` or `stranger`
 */
export function prOwnership({
  author,
  authorType,
  headRepository,
  ownRepository,
  bots,
}: {
  author: string | undefined;
  authorType?: string | undefined;
  headRepository?: string | undefined;
  ownRepository?: string | undefined;
  bots: DependencyBotActors;
}): "owned" | "stranger" {
  if (headRepository !== undefined && ownRepository !== undefined && headRepository !== ownRepository) {
    return "stranger";
  }
  if (author === undefined) {
    return "owned";
  }
  const unlistedApp = authorType === "Bot" && author.endsWith("[bot]") && !bots.bumpRestLogins.includes(author);
  return unlistedApp || bots.renovateRestLogins.includes(author) ? "stranger" : "owned";
}
