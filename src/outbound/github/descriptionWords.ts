/**
 * The content rules a layout-2 C3 description is held to: what its WORDS may say, where `./formRules.ts` holds what
 * its shape may be. Pure, and read by both the write schema and the CI gate through `c3FormErrors`, so a form the
 * door accepts renders a body CI accepts. A body in layout 1 was published before these rules and is never judged by
 * them (`./types.ts`'s `BodyLayout`).
 *
 * Each rule is the owner's call on the description briefing, made computable and kept narrow:
 *
 * - **A proof slot holds a capture, never a sentence about a test.** The common shapes of a reason that talks about
 *   a test (`vitest`, "a unit test", "the test fails", "the test shows it", "pinned by a test", "the unit cases",
 *   "the cases below", "the specs are the proof") are refused here; the description review refuses the rest, so
 *   this is a list of refused shapes, never a whitelist of pointers. Where a command can show it, the proof is a
 *   `browser terminal-shot` of that command failing on main and passing on the branch, and a sentence about a test
 *   belongs under Checks. A reason's optional second sentence points at the checks or a linked record instead ("The
 *   checks below are the proof."). One reason in both slots is refused too.
 * - **The title and explainer use words a teammate knows.** Slopweaver's own words (seat, handoff, chain, seed,
 *   register, door, lap, row, relay, projection) are refused there outside a code run. A table "row" is refused with
 *   the rest: that false positive was named and accepted.
 * - **CI's work stays off the page.** A check or not-checked item saying lint, typecheck or a gate passed, or that
 *   whole-repo work was left to CI, is refused: the pull request's own check list shows it.
 * - **Code is formatted as code.** A file name, a `--flag`, a snake_case or SCREAMING_CASE variable, or a
 *   `slopweaver`/`yarn` command written as plain text is refused, naming it, rather than wrapped silently.
 * - **Bold is for a figure.** A strong run carries a number and at most four words.
 * - **A commit is a link.** A bare 7 to 40 character hex id outside a link run is refused.
 * - **Name who it hit.** An explainer opening "Anyone", "Any install", "For anyone" or "Everyone" is refused.
 *
 * Left out on purpose: "an agent ran it" in the problem hover only after a run. The form records who saw the problem
 * (`problemSeen.by`) but nothing records whether a run happened, so no rule here could tell a true claim from a
 * false one.
 *
 * A code run and a link are skipped by the prose rules, each contributing one space, because an identifier and
 * somebody else's title are not the author's words; `strong` and `em` are scanned. The test-sentence and CI-work
 * rules read every run, code included, since "`yarn lint` passes" is CI's work whatever run holds the command.
 */
import { isSecretHit, scanContent } from "../../hygiene/scan.js";
import type { FormRuleIssue } from "./formRules.js";
import type { Content, PrBody } from "./types.js";

/** One content cell a rule reads, with the form path a caller goes and fixes. */
interface Cell {
  readonly content: Content;
  readonly path: readonly (string | number)[];
}

/** The text of every run, code included. */
function allTextOf({ content }: { content: Content }): string {
  return content.map((run) => run.text).join("");
}

/** The author's own words: text, strong and em runs, each code or link run read as one space. */
function proseOf({ content }: { content: Content }): string {
  return content.map((run) => (run.kind === "code" || run.kind === "link" ? " " : run.text)).join("");
}

/** Every content cell a body carries, with its path. */
function cellsOf({ body }: { body: PrBody }): readonly Cell[] {
  const cells: Cell[] = [{ content: body.explainer, path: ["explainer"] }];
  for (const field of ["problemProof", "solutionProof"] as const) {
    const slot = body[field];
    cells.push(
      slot.kind === "reason"
        ? { content: slot.reason, path: [field, "reason"] }
        : { content: slot.proves, path: [field, "proves"] },
    );
  }
  cells.push(...checkCellsOf({ body }));
  body.notChecked.forEach((item, index) => {
    cells.push({ content: item.why, path: ["notChecked", index, "why"] });
  });
  if (body.checkGroups !== undefined) {
    body.checkGroups.forEach((group, index) => {
      cells.push({ content: group.label, path: ["checkGroups", index, "label"] });
    });
  }
  body.rerun.forEach((item, index) => {
    if (item.kind === "note") {
      cells.push({ content: item.content, path: ["rerun", index] });
    }
  });
  return cells;
}

/** Every check a body lists — base, grouped, and what was not checked — with its path. */
function checkCellsOf({ body }: { body: PrBody }): readonly Cell[] {
  const cells: Cell[] = body.checks.map((content, index) => ({ content, path: ["checks", index] }));
  if (body.checkGroups !== undefined) {
    body.checkGroups.forEach((group, groupIndex) => {
      group.items.forEach((content, index) => {
        cells.push({ content, path: ["checkGroups", groupIndex, "items", index] });
      });
    });
  }
  body.notChecked.forEach((item, index) => {
    cells.push({ content: item.check, path: ["notChecked", index, "check"] });
  });
  return cells;
}

/** Sentences about a test, which a proof slot may not hold. */
const TEST_SENTENCE: readonly RegExp[] = [
  /\bvitest\b/iu,
  /\b(?:unit|test|integration|regression|subprocess|replay|e2e|end-to-end) (?:tests?|cases?)\b/iu,
  /\b(?:tests?|specs?)\b.{0,60}?\b(?:fails?|failed|failing|pass(?:es|ed)?|passing|reproduces?|reproduced|covers?|covered|pins?|pinned|proves?|proved|verif(?:y|ies|ied)|asserts?|asserted|catches|caught|shows|showed|shown|demonstrates|demonstrated|confirms|confirmed|exercises|exercised)\b/iu,
  /\b(?:tests|specs) (?:show|demonstrate|confirm|exercise)\b/iu,
  /\b(?:pinned|reproduced|covered|proved|proven|verified|caught|shown) by (?:a|an|the|this|its|their|new)\b.{0,40}?\btests?\b/iu,
  /\b(?:tests?|the cases?) (?:below|above)\b/iu,
  /\b(?:tests?|specs?)\b.{0,60}?\bthe proof\b/iu,
  /\bcases\b.{0,60}?\b(?:is|are) the proof\b/iu,
  /\bthe proof is\b.{0,60}?\b(?:tests?|specs?|cases)\b/iu,
];

/** A proof reason that is a sentence about a test, and one reason in both slots. */
function proofReasonIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  const issues: FormRuleIssue[] = [];
  for (const field of ["problemProof", "solutionProof"] as const) {
    const slot = body[field];
    if (slot.kind === "reason" && TEST_SENTENCE.some((pattern) => pattern.test(allTextOf({ content: slot.reason })))) {
      issues.push({
        code: "PROOF_IS_TEST_SENTENCE",
        message:
          "a proof reason is a sentence about a test. Where a command can show it, capture that command failing on " +
          "main and passing on this branch with `slopweaver browser terminal-shot` and attach the picture; move the " +
          "sentence about the test to checks",
        path: [field, "reason"],
      });
    }
  }
  const { problemProof, solutionProof } = body;
  if (problemProof.kind === "reason" && solutionProof.kind === "reason") {
    const normalise = ({ content }: { content: Content }): string =>
      allTextOf({ content }).trim().toLowerCase().replace(/\s+/gu, " ");
    if (normalise({ content: problemProof.reason }) === normalise({ content: solutionProof.reason })) {
      issues.push({
        code: "REASON_REPEATED",
        message:
          "both proof slots give the same reason, so the body prints one sentence twice. Say once why there is " +
          "nothing to show: give the solution its own reason, or capture one of the two",
        path: ["solutionProof", "reason"],
      });
    }
  }
  return issues;
}

/** Slopweaver's own words, which a teammate reading a title or explainer does not know. */
const TEAMMATE_WORDS = /\b(?:seats?|handoffs?|chains?|seeds?|registers?|doors?|laps?|rows?|relays?|projections?)\b/giu;

/**
 * Every Slopweaver word in one piece of prose.
 *
 * @returns the words found, lowercased and each once
 */
function teammateWordsIn({ prose }: { prose: string }): readonly string[] {
  return [...new Set([...prose.matchAll(TEAMMATE_WORDS)].map((match) => match[0].toLowerCase()))];
}

/**
 * A title's own words: the conventional `kind(scope):` prefix and every backtick span taken out, since GitHub draws
 * a backtick span as code.
 *
 * @returns the title's prose
 */
function titleProseOf({ title }: { title: string }): string {
  return title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/u, "").replace(/`[^`]*`/gu, " ");
}

/** Slopweaver's own words in the title or the explainer. */
function teammateWordIssues({ body, title }: { body: PrBody; title: string | undefined }): readonly FormRuleIssue[] {
  const issues: FormRuleIssue[] = [];
  const places = [
    ...(title === undefined ? [] : [{ path: ["title"], prose: titleProseOf({ title }), what: "the title" }]),
    { path: ["explainer"], prose: proseOf({ content: body.explainer }), what: "the explainer" },
  ];
  for (const { path, prose, what } of places) {
    const words = teammateWordsIn({ prose });
    if (words.length > 0) {
      issues.push({
        code: "TEAMMATE_WORDS",
        message:
          `${what} uses Slopweaver's own words a teammate does not know (${words.map((word) => `"${word}"`).join(", ")}). ` +
          "Say what happened in words anyone on the team knows, or put a name in a code run",
        path,
      });
    }
  }
  return issues;
}

/** CI's work, which the pull request's own check list already shows. */
const CI_WORK: readonly RegExp[] = [
  /\b(?:lint|linter|linting|typecheck|type-check|type check|tsc|biome|prettier|oxlint|format check)\b.{0,40}?\b(?:pass(?:es|ed)?|green|clean|exits? 0|exited 0|succeed(?:s|ed)?)\b/iu,
  /\bwhole[- ]repo(?:sitory)? (?:typecheck|type-check|lint|build|test run)\b/iu,
  /\bfull (?:lint|typecheck|type-check|test (?:run|suite))\b/iu,
  /\b(?:left to|handled by|runs? in|ran in|run by|covered by|checked by) CI\b/iu,
  /\bgates?\b.{0,40}?\b(?:pass(?:es|ed)?|green|clean)\b/iu,
  /\bCI\b.{0,20}?\b(?:pass(?:es|ed)?|green)\b/u,
];

/** A check or not-checked item that reports CI's work. */
function ciWorkIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return checkCellsOf({ body })
    .filter(({ content }) => CI_WORK.some((pattern) => pattern.test(allTextOf({ content }))))
    .map(({ path }) => ({
      code: "CI_WORK",
      message:
        "a check reports CI's work (lint, typecheck or a gate passing, or work left to CI). The pull request's own " +
        "check list shows that; list only what was checked by hand, or remove it",
      path,
    }));
}

/** What plain text may not carry: each, and the kind of thing it is, named in the refusal. */
const CODE_SHAPES: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /(?<![\w-])--[a-z][a-z0-9-]*/gu, what: "a flag" },
  { pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu, what: "a variable" },
  { pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/gu, what: "a variable" },
  {
    pattern:
      /(?<![\w/.-])[\w./-]*[\w-]\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|yml|yaml|toml|sh|css|html|png|jpg|jpeg|svg)\b/gu,
    what: "a file name",
  },
  { pattern: /(?<![\w-])(?:slopweaver|yarn) [a-z][\w:-]*/gu, what: "a command" },
];

/** A product name spelled like a file (`Node.js`), which is not code. */
const PRODUCT_NAME = /^[A-Z][a-z]+\.js$/u;

/**
 * Every piece of code written as plain text in one piece of prose.
 *
 * @returns each token with what it is, in order, each once
 */
function unformattedCodeIn({ prose }: { prose: string }): readonly string[] {
  const found: string[] = [];
  for (const { pattern, what } of CODE_SHAPES) {
    for (const match of prose.matchAll(pattern)) {
      if (!PRODUCT_NAME.test(match[0])) {
        found.push(`${what} "${match[0]}"`);
      }
    }
  }
  return [...new Set(found)];
}

/** Code written as plain text, in the title and every cell. */
function codeFormattingIssues({ body, title }: { body: PrBody; title: string | undefined }): readonly FormRuleIssue[] {
  const places = [
    ...(title === undefined ? [] : [{ path: ["title"], prose: titleProseOf({ title }) }]),
    ...cellsOf({ body }).map(({ content, path }) => ({ path, prose: proseOf({ content }) })),
  ];
  return places.flatMap(({ path, prose }) => {
    const found = unformattedCodeIn({ prose });
    if (found.length === 0) {
      return [];
    }
    return [
      {
        code: "CODE_UNFORMATTED" as const,
        message:
          `${found.join(", ")} is written as plain text. Put each in a { "kind": "code" } run (in an authoring file ` +
          "or a title, between backticks)",
        path,
      },
    ];
  });
}

/** A strong run that is not a figure: it carries no digit, or more than four words. */
function boldIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return cellsOf({ body }).flatMap(({ content, path }) =>
    content
      .filter((run) => run.kind === "strong")
      .filter((run) => !/\d/u.test(run.text) || run.text.trim().split(/\s+/u).length > 4)
      .map((run) => ({
        code: "BOLD_NOT_A_FIGURE" as const,
        message: `"${run.text}" is bold but is not a figure. Bold only a number, such as "309.9 seconds"; make the rest plain text`,
        path,
      })),
  );
}

/** A commit id: 7 to 40 hex characters with at least one digit and one letter, standing alone. */
const COMMIT_ID = /(?<![\w/#.-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![\w/-])/giu;

/** A commit id written outside a link run: in prose, or as the whole of a code run. */
function commitLinkIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return cellsOf({ body }).flatMap(({ content, path }) => {
    const ids = content.flatMap((run) => {
      if (run.kind === "link") {
        return [];
      }
      if (run.kind === "code") {
        const whole = new RegExp(`^${COMMIT_ID.source}$`, "iu");
        return whole.test(run.text.trim()) ? [run.text.trim()] : [];
      }
      return [...run.text.matchAll(COMMIT_ID)].map((match) => match[0]);
    });
    return [...new Set(ids)].map((id) => ({
      code: "COMMIT_UNLINKED" as const,
      message:
        `the commit "${id}" is not a link. Link it: { "kind": "link", "text": "${id}", "url": ` +
        `"https://github.com/<owner>/<repo>/commit/${id}" }`,
      path,
    }));
  });
}

/** An explainer that opens on everybody rather than on who it hit. */
const AUDIENCE_OPENING = /^(?:anyone|any install(?:ation)?|for anyone|everyone)\b/iu;

/** An explainer opening on "anyone". */
function audienceIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  if (!AUDIENCE_OPENING.test(allTextOf({ content: body.explainer }).trimStart())) {
    return [];
  }
  return [
    {
      code: "AUDIENCE_UNNAMED",
      message: 'the explainer opens on "anyone". Name who it hit: open on who met the problem and what they saw',
      path: ["explainer"],
    },
  ];
}

/** The rules whose message quotes the author's own text back, so a credential in it would print with it. */
const QUOTING_CODES: ReadonlySet<FormRuleIssue["code"]> = new Set<FormRuleIssue["code"]>([
  "BOLD_NOT_A_FIGURE",
  "CODE_UNFORMATTED",
  "COMMIT_UNLINKED",
]);

/** What a quoting rule says instead when the description carries a credential shape. */
const WITHHELD_MESSAGE =
  "this rule quotes the text it found, and the description carries a credential shape, so the finding is withheld " +
  "from this log. Remove the credential the secret scan names, and the finding prints in full";

/**
 * Whether the title or any cell carries a credential shape: the secret scan's own classes, so a refusal quoting a
 * `ghp_` token as "a variable" never prints what that scan redacts.
 *
 * @returns true when a credential class matches anywhere a quoting rule reads
 */
function carriesCredential({ body, title }: { body: PrBody; title: string | undefined }): boolean {
  const texts = cellsOf({ body }).map(({ content }) => allTextOf({ content }));
  if (title !== undefined) {
    texts.push(title);
  }
  return scanContent({ content: texts.join("\n"), denylist: [], path: "description" }).some((hit) =>
    isSecretHit({ label: hit.label }),
  );
}

/**
 * Every issue as given, bar one whose own message carries a credential shape, which keeps its code and path and
 * prints {@link WITHHELD_MESSAGE}: a rule outside the word rules can quote a field too, as the hosting rule quotes a
 * screenshot's address.
 *
 * @param issues the issues every rule returned, before any reaches a log
 * @returns the same issues in order, none of whose messages the secret scan's credential classes match
 */
export function withholdingCredentialMessages({
  issues,
}: {
  issues: readonly FormRuleIssue[];
}): readonly FormRuleIssue[] {
  return issues.map((issue) =>
    carriesCredentialShape({ text: issue.message }) ? { ...issue, message: WITHHELD_MESSAGE } : issue,
  );
}

/**
 * Whether a line of text carries a credential shape, by the secret scan's own classes.
 *
 * @param text a refusal or issue line about to reach a log
 * @returns true when a credential class matches anywhere in it
 */
function carriesCredentialShape({ text }: { text: string }): boolean {
  return scanContent({ content: text, denylist: [], path: "description" }).some((hit) =>
    isSecretHit({ label: hit.label }),
  );
}

/**
 * What a refusal line says instead when it would quote a credential shape: a rule that quotes the title, a field or
 * a recovered run would otherwise print the token with its refusal. The secret scan's own line names the class.
 */
const WITHHELD_CREDENTIAL_LINE =
  "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
  "the secret scan names, and the refusal prints in full";

/**
 * Every refusal line as given, bar one carrying a credential shape, which prints {@link WITHHELD_CREDENTIAL_LINE}
 * instead: the line-level twin of {@link withholdingCredentialMessages}, for a gate whose verdict is plain lines.
 *
 * @param lines the refusal lines about to reach a log, in order
 * @returns the same lines in order, none of which the secret scan's credential classes match
 */
export function withholdingCredentialLines({ lines }: { lines: readonly string[] }): readonly string[] {
  return lines.map((line) => (carriesCredentialShape({ text: line }) ? WITHHELD_CREDENTIAL_LINE : line));
}

/**
 * A writer that forwards every line as given, bar one carrying a credential shape, which it forwards as
 * {@link WITHHELD_CREDENTIAL_LINE} instead. The description door's production `out` and `err` are built through
 * this, so a refusal reaching a log is withheld at the writer, by construction, rather than at each exit an audit
 * found: two reviews of the per-exit fix each found an exit the audit before had missed.
 *
 * A line is scanned whole, newlines included, so a credential the scan only recognises across lines (a private-key
 * block) is caught as one text, and the whole line is withheld.
 *
 * @param write the real sink the filtered line is forwarded to
 * @returns a sink of the same shape whose every forwarded line the secret scan's credential classes do not match
 */
export function withholdingCredentialWriter({
  write,
}: {
  write: (args: { line: string }) => void;
}): (args: { line: string }) => void {
  return ({ line }) => {
    write({ line: carriesCredentialShape({ text: line }) ? WITHHELD_CREDENTIAL_LINE : line });
  };
}

/**
 * Every content rule a layout-2 body breaks. Empty means its words conform.
 *
 * A rule that quotes the author's text keeps its code and path but prints {@link WITHHELD_MESSAGE} when the body or
 * title carries a credential shape. The private denylist is not read here: a denylisted literal a quoting rule
 * matches prints as found, beside the secret scan's own redacted refusal of it.
 *
 * @param title the pull request's title when the caller has it; absent, the two title rules do not run
 * @returns one issue per broken rule, each with its code and the form path to fix
 */
export function descriptionWordIssues({
  body,
  title,
}: {
  body: PrBody;
  title: string | undefined;
}): readonly FormRuleIssue[] {
  const issues = [
    ...proofReasonIssues({ body }),
    ...teammateWordIssues({ body, title }),
    ...ciWorkIssues({ body }),
    ...codeFormattingIssues({ body, title }),
    ...boldIssues({ body }),
    ...commitLinkIssues({ body }),
    ...audienceIssues({ body }),
  ];
  if (!carriesCredential({ body, title })) {
    return issues;
  }
  return issues.map((issue) => (QUOTING_CODES.has(issue.code) ? { ...issue, message: WITHHELD_MESSAGE } : issue));
}
