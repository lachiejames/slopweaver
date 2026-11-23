/**
 * The SOP gate: every detector, composed, over one markdown document.
 *
 * ## Why this runs at all when the renderer already guarantees the shape
 *
 * `sop draft` writes the shape correctly by construction, so a freshly rendered document passes every check
 * here trivially. That is not wasted work: the draft is written to a FILE precisely so a person can edit it
 * before it goes anywhere, and `sop publish` lints whatever is on disk rather than whatever the form said.
 * These detectors exist for the EDITED draft.
 *
 * ## The findings are all blockers, and that is the difference from the proposal gate
 *
 * `../proposal/lint/findings.ts` splits severity because most of what it judges is a judgement — whether a
 * document reads as an invitation, whether a framing lands. Nothing here is a judgement. Each detector below
 * asserts a section a reader needs in order to ACT, and a procedure missing one is not a weaker procedure,
 * it is a page that cannot be followed. So there is one severity and no warning tier to route around.
 *
 * Pure: markdown in, findings out. No I/O, no state home, no profile.
 */

/**
 * One thing the SOP linter found.
 *
 * @internal
 */
export interface SopFinding {
  /** A stable kebab-case rule id, so a finding can be talked about without quoting its message. */
  readonly rule: string;
  readonly message: string;
  /** The 1-indexed line the finding points at, when the detector knows one. */
  readonly line?: number | undefined;
}

/**
 * What a lint pass produced. `blocked` is a boolean; the exit code it maps to is the CLI's call.
 *
 * @internal
 */
export interface SopLintResult {
  readonly findings: readonly SopFinding[];
  readonly blocked: boolean;
}

/** The house section order, keyed. A heading maps to at most one key. */
const REQUIRED_SECTIONS: readonly (readonly [string, RegExp])[] = [
  ["at-a-glance", /^at a glance\b/i],
  ["purpose", /^purpose\b/i],
  ["when", /^when this applies\b/i],
  ["scope", /^scope\b/i],
  ["steps", /^steps\b/i],
  ["escalation", /^escalation\b/i],
  ["source", /^where this came from\b/i],
];

/** The same placeholder literals the schema refuses, applied to a document nobody re-validated. */
const PLACEHOLDER = /\b(?:TODO|TBD|TBC|FIXME)\b|\?{3}/i;

/** A top-level section heading. */
const SECTION_HEADING = /^##\s(.*)$/;

/** A step heading, as the renderer emits them. */
const STEP_HEADING = /^###\s+\d+\.\s+\S/;

/** The actor line every step carries. */
const WHO_LINE = /^\*\*Who:\*\*\s+\S/;

/** Any markdown heading, for bounding a step's own region. */
const ANY_HEADING = /^#{1,6}\s/;

/** A markdown link with a real http(s) target. */
const LINKED_SOURCE = /\[[^\]]+\]\(https?:\/\/[^)]+\)/;

/** The sentence that tells a reader nobody has checked this page yet. */
const UNREVIEWED_MARKER = /has not reviewed it yet/i;

/** Every `## ` section key the document carries, in the order it carries them. */
function sectionKeys({ lines }: { lines: readonly string[] }): readonly string[] {
  return lines.flatMap((line) => {
    const heading = SECTION_HEADING.exec(line);
    if (heading === null) {
      return [];
    }
    const key = REQUIRED_SECTIONS.find(([, matcher]) => matcher.test(heading[1]!.trim()))?.[0];
    return key === undefined ? [] : [key];
  });
}

/**
 * BLOCK: every house section, in the house order.
 *
 * @param lines the document's lines
 * @returns one finding per missing section, plus one when the order is wrong
 */
function sectionOrder({ lines }: { lines: readonly string[] }): readonly SopFinding[] {
  const found = sectionKeys({ lines });
  const missing = REQUIRED_SECTIONS.filter(([key]) => !found.includes(key)).map(([key]) => key);
  const present = REQUIRED_SECTIONS.filter(([key]) => found.includes(key)).map(([key]) => key);
  const ordered = found.filter((key, index) => found.indexOf(key) === index);
  return [
    ...missing.map((key) => ({
      message: `the "${key}" section is missing. A reader who cannot find it cannot follow the procedure.`,
      rule: "missing-section",
    })),
    ...(missing.length === 0 && ordered.join(">") !== present.join(">")
      ? [
          {
            message: `sections are out of order: ${ordered.join(" > ")}. The house order is ${present.join(" > ")}.`,
            rule: "section-order",
          },
        ]
      : []),
  ];
}

/**
 * BLOCK: an unfilled placeholder anywhere in the document.
 *
 * The class it catches: a governing SOP whose section is still a placeholder leaves a triage unable to check a
 * request against it at all. The page is found and read and still cannot be acted on, which is the failure this
 * detector exists for.
 *
 * @param lines the document's lines
 * @returns one finding per line carrying a placeholder
 */
function noPlaceholder({ lines }: { lines: readonly string[] }): readonly SopFinding[] {
  return lines.flatMap((text, index) =>
    PLACEHOLDER.test(text)
      ? [
          {
            line: index + 1,
            message: `an unfilled placeholder: ${JSON.stringify(text.trim().slice(0, 60))}. Fill it or cut it.`,
            rule: "unfilled-placeholder",
          },
        ]
      : [],
  );
}

/**
 * BLOCK: every step names who performs it.
 *
 * A step with no actor is the gap that sends a request round three teams before anybody starts, and it is
 * invisible in a document that otherwise reads perfectly.
 *
 * @param lines the document's lines
 * @returns one finding per step with no actor line
 */
function stepsNameAnActor({ lines }: { lines: readonly string[] }): readonly SopFinding[] {
  return lines.flatMap((text, index) => {
    if (!STEP_HEADING.test(text)) {
      return [];
    }
    const rest = lines.slice(index + 1);
    const nextHeading = rest.findIndex((line) => ANY_HEADING.test(line));
    const region = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    return region.some((line) => WHO_LINE.test(line))
      ? []
      : [
          {
            line: index + 1,
            message: `step ${JSON.stringify(text.replace(/^###\s+/, ""))} names nobody. Every step carries **Who:**.`,
            rule: "step-without-actor",
          },
        ];
  });
}

/**
 * BLOCK: the source is a link a reader can open.
 *
 * A procedure asserting what the org does, with no way back to where that was decided, cannot be checked
 * against what actually happened — and a reader cannot tell an accurate one from an invented one.
 *
 * @param lines the document's lines
 * @returns the finding, or nothing
 */
function sourceIsLinked({ lines }: { lines: readonly string[] }): readonly SopFinding[] {
  const at = lines.findIndex((line) => {
    const heading = SECTION_HEADING.exec(line);
    return heading !== null && /^where this came from\b/i.test(heading[1]!.trim());
  });
  if (at === -1) {
    return [];
  }
  return lines.slice(at).some((line) => LINKED_SOURCE.test(line))
    ? []
    : [
        {
          line: at + 1,
          message:
            'no openable source link under "Where this came from". A procedure nobody can trace is a ' +
            "procedure nobody can check.",
          rule: "unlinked-source",
        },
      ];
}

/**
 * BLOCK: the unreviewed-draft notice is still there.
 *
 * Deleting it is the one edit that changes what the page CLAIMS rather than what it says: without it a
 * machine-drafted procedure reads as one a person signed off. Publishing is Slopweaver's; vouching for the
 * content is the named owner's, and this line is where that boundary is written down.
 *
 * @param lines the document's lines
 * @returns the finding, or nothing
 */
function keepsUnreviewedNotice({ lines }: { lines: readonly string[] }): readonly SopFinding[] {
  return lines.some((line) => UNREVIEWED_MARKER.test(line))
    ? []
    : [
        {
          message:
            "the unreviewed-draft notice is gone. It is what stops a machine-drafted procedure reading as " +
            "one its named owner has already signed off; the owner removes it, by reviewing the page.",
          rule: "missing-unreviewed-notice",
        },
      ];
}

/** Every detector, in reporting order. */
const DETECTORS = [sectionOrder, noPlaceholder, stepsNameAnActor, sourceIsLinked, keepsUnreviewedNotice] as const;

/**
 * Lint one SOP document.
 *
 * @param markdown the document body, without its title (the title is a Notion page property)
 * @returns every finding, and whether any of them blocks a publish
 */
export function lintSop({ markdown }: { markdown: string }): SopLintResult {
  const lines = markdown.split(/\r?\n/u);
  const findings = DETECTORS.flatMap((detect) => detect({ lines }));
  return { blocked: findings.length > 0, findings };
}

/**
 * The operator-facing report.
 *
 * @param findings every finding from a lint pass
 * @returns the lines to print
 */
export function sopFindingLines({ findings }: { findings: readonly SopFinding[] }): readonly string[] {
  if (findings.length === 0) {
    return [];
  }
  return [
    `${String(findings.length)} blocking finding(s):`,
    ...findings.map(
      (finding) =>
        `  [${finding.rule}]${finding.line === undefined ? "" : ` line ${String(finding.line)}:`} ${finding.message}`,
    ),
  ];
}
