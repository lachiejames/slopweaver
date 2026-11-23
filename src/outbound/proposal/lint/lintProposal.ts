/**
 * The golden-proposal gate: every detector, composed, over one markdown document.
 *
 * A blocker stops a publish. `proposal publish` calls this same function on the bytes it is about to send,
 * so a document cannot reach Notion carrying an uncited figure, a raw URL, a missing section, or a phrase
 * from the operator's own banned list.
 *
 * Pure: markdown plus the operator's private rule list in, findings and an exit code out. The rule list is
 * INJECTED rather than read here, so this file stays testable with no state home and no profile on disk.
 */
import type { ExactVoiceRule } from "../../voice/exactRules.js";
import { parseProposalBlocks } from "./blocks.js";
import { figuresAreCited, noReferenceMarkers, urlsAreAnchored } from "./evidence.js";
import { hasBlocker, type ProposalFinding } from "./findings.js";
import {
  hasStrawman,
  hasTableOfContents,
  heroImageInTopThird,
  imagesClusteredAtEnd,
  invitesPushback,
  sectionOrder,
} from "./structure.js";
import { exactVoiceFindings, headcountFraming, hedgeProjections, noExclamation, scaffoldTells } from "./voice.js";

/**
 * What a lint pass produced.
 *
 * `blocked` is a boolean rather than an exit code on purpose. The pure gate says whether the document may
 * publish; which process exit code that maps to is the CLI's decision, and hard-coding one here made the
 * "not ready" answer indistinguishable from `EXIT_USAGE`, which means "you typed the command wrong".
 */
export interface ProposalLintResult {
  readonly findings: readonly ProposalFinding[];
  readonly blocked: boolean;
}

/** Detectors that read the whole document as text. */
const PROSE_DETECTORS = [
  figuresAreCited,
  urlsAreAnchored,
  noReferenceMarkers,
  noExclamation,
  headcountFraming,
  hedgeProjections,
] as const;

/** Detectors that read the ordered block model. */
const BLOCK_DETECTORS = [
  sectionOrder,
  heroImageInTopThird,
  imagesClusteredAtEnd,
  hasStrawman,
  hasTableOfContents,
  invitesPushback,
] as const;

/**
 * Lint one golden-proposal document.
 *
 * @param markdown the document body, without its title (the title is a Notion page property)
 * @param voiceRules the operator's private exact-rule list; an empty list simply gates nothing on vocabulary
 * @returns every finding, and whether any of them blocks a publish
 */
export function lintProposal({
  markdown,
  voiceRules,
}: {
  markdown: string;
  voiceRules: readonly ExactVoiceRule[];
}): ProposalLintResult {
  const blocks = parseProposalBlocks({ markdown });
  const findings: ProposalFinding[] = [
    ...PROSE_DETECTORS.flatMap((detect) => {
      const finding = detect({ markdown });
      return finding === undefined ? [] : [finding];
    }),
    ...BLOCK_DETECTORS.flatMap((detect) => {
      const finding = detect({ blocks });
      return finding === undefined ? [] : [finding];
    }),
    ...scaffoldTells({ markdown }),
    ...exactVoiceFindings({ markdown, rules: voiceRules }),
  ];
  return { blocked: hasBlocker({ findings }), findings };
}

/**
 * The operator-facing report: blockers first, then warnings.
 *
 * @param findings every finding from a lint pass
 * @returns the lines to print
 */
export function proposalFindingLines({ findings }: { findings: readonly ProposalFinding[] }): readonly string[] {
  const blockers = findings.filter((finding) => finding.severity === "blocker");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const render = ({ finding }: { finding: ProposalFinding }): string =>
    `  [${finding.rule}]${finding.line === undefined ? "" : ` line ${String(finding.line)}:`} ${finding.message}`;
  return [
    ...(blockers.length === 0 ? [] : [`${String(blockers.length)} blocking finding(s):`]),
    ...blockers.map((finding) => render({ finding })),
    ...(warnings.length === 0 ? [] : [`${String(warnings.length)} warning(s):`]),
    ...warnings.map((finding) => render({ finding })),
  ];
}
