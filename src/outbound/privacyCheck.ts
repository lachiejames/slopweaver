/**
 * The outbound privacy check: ONE rule-based judgement of a text about to leave this machine, the same rules for
 * every destination. Pure — text in, findings out — so the write seams call it on the bytes they send, and a
 * sweep or a leak audit calls it on text already posted.
 *
 * ## What it refuses
 *
 * - **Installation state.** A pointer back into this installation is meaningless to every other reader and
 *   identifies the install to all of them: a `transcript:`/`talk-call:` pointer, a session/transcript/thread
 *   UUID, an `observed by <session>` origin, an absolute home path (`/Users/<name>`, `/home/<name>`,
 *   `~/.slopweaver`, `$HOME/.slopweaver`) and a per-machine temp path. Judged on the WHOLE text, code spans
 *   included, because a concrete value identifies the install however it is formatted. The literal
 *   `$SLOPWEAVER_HOME/...` is the generic spelling and passes; it is what the fix tells the author to write.
 * - **The hygiene gate's own refusals.** A credential shape, a denylisted term, or a forbidden identifier
 *   wherever `IDENTIFIER_VERDICT` reads `refuse` — `../hygiene/scan.ts`'s `scanContent` and `isRefusedHit`, and
 *   `../hygiene/installationIdentifiers.ts`'s span-exact forgiveness. Nothing matched is ever echoed.
 * - **Private terms.** The installation's own private words (`../hygiene/privateTerms.ts`), each refused under
 *   its class. The one thing forgiven is a match wholly inside the exact address of the destination's own
 *   repository (`ownAddressRanges`), since the owner's handle is in every link to it; the bare handle elsewhere,
 *   another repository's address, and every other term still refuse. The caller loads the file and refuses before
 *   calling when it cannot.
 *
 * ## One rule, destinations that differ only in fact
 *
 * The destination never switches a class off. What it carries is FACTS about where the text goes — the
 * repository the write targets, the installation identifiers that repository legitimately holds — and one
 * forgiveness rule reads them identically for every destination. A destination with no facts is the strict one,
 * which refuses the most; that is what an audit of already-posted text passes.
 *
 * ## What it does not judge: personal material and paraphrase
 *
 * Rules match shapes and listed terms. A paraphrase of something private carries neither, so no rule here can
 * catch it. The owner ruled that personal material gets an AI assessment, and its model and budget are the owner's
 * open call, and AGENTS.md rule 2 means a model runs only in a session the owner can see, never inside a check a
 * write seam calls. So the assessment is an INPUT this check carries, produced elsewhere, never something it
 * computes, and today nothing produces one: every caller passes {@link UNASSESSED_PERSONAL_MATERIAL}, and the
 * verdict says so, so a clean verdict never reads as "paraphrases were checked".
 *
 * There is no override. Each finding names the fix, and every fix is a rewording that is always possible. The one
 * route besides rewording is the private-words review, and it is not an override: a write whose ONLY findings are
 * private terms on rows carrying the owner's meaning is held, and a fresh reviewer's CLEAN verdict over exactly those
 * bytes releases it once (`./privateTermReview/gate.ts`). Every other finding still refuses outright.
 */
import type { ForbiddenIdentifierRules } from "../hygiene/identifierScan.js";
import { type InstallationIdentifiers, pullRequestIdentifierHits } from "../hygiene/installationIdentifiers.js";
import { ownAddressRanges } from "../hygiene/ownRepository.js";
import { type PrivateTermMatch, privateTermHits, privateTermMatches } from "../hygiene/privateTermMatches.js";
import {
  type PrivateTerm,
  type PrivateTermClass,
  printableUnderTerms,
  privateTermFindingSentence,
} from "../hygiene/privateTerms.js";
import { DENYLIST_LABEL, isRefusedHit, scanContent } from "../hygiene/scan.js";

/**
 * One text the check judges, and where it is reported.
 * @internal — part of {@link checkPrivacy}'s contract; the write transports and the posted-text sweep import it next.
 */
export interface PrivacyContent {
  /**
   * Where the text sits, as a refusal names it: a surface label (`PR description`), or any locus a sweep reports
   * (`pr/57/comment/123`). Never required to be a file path.
   */
  readonly locus: string;
  /** The text exactly as it is, or was, sent. */
  readonly text: string;
}

/**
 * The facts about where a text goes that the one forgiveness rule reads. Never a switch: a field left undefined
 * forgives nothing.
 * @internal — part of {@link checkPrivacy}'s contract; the write transports and the posted-text sweep import it next.
 */
export interface PrivacyDestination {
  /** The target repository, `owner/repo`, whose own address the identifier half does not count. */
  readonly ownRepository: string | undefined;
  /** The installation's own identifiers, given only where the destination is the installation's own. */
  readonly installationIdentifiers: InstallationIdentifiers | undefined;
  /**
   * Who reads a forbidden identifier there. `installation-workspace` where the destination IS the installation's own
   * organisation workspace (its Slack, its Linear), whose readers expect its names: it forgives FORBIDDEN-IDENTIFIER
   * findings only — never installation state, a credential, a denylisted term or a private term. `strict` everywhere
   * outside by default. Each residue is the destination's own: a Slack Connect channel, a Linear guest or shared surface.
   */
  readonly identifierAudience: "strict" | "installation-workspace";
}

/**
 * What the rules read beyond the committed patterns.
 * @internal — part of {@link checkPrivacy}'s contract; the write transports and the posted-text sweep import it next.
 */
export interface PrivacyPolicy {
  /** The private denylist (`loadDenylist`); empty still catches every credential shape. */
  readonly denylist: readonly string[];
  /** The forbidden-identifier rules: the committed ones, or synthetic ones a test injects. */
  readonly identifierRules: ForbiddenIdentifierRules;
  /** The installation's private terms (`../hygiene/privateTerms.ts`), loaded by the caller; `[]` only when the file says none. */
  readonly privateTerms: readonly PrivateTerm[];
}

/**
 * The personal-material assessment a check carries: produced by a visible session, never by this module. Only
 * `unassessed` exists in practice until the owner names the assessment's model and budget.
 * @internal — the port's shape; its first producer is the visible-session assessment, which is the owner's call.
 */
export type PersonalMaterialAssessment =
  | { readonly kind: "unassessed" }
  | { readonly kind: "clear"; readonly receiptId: string }
  | { readonly kind: "refused"; readonly receiptId: string; readonly reasons: readonly string[] };

/** The assessment every caller passes today: none was made, and the verdict says so. */
export const UNASSESSED_PERSONAL_MATERIAL: PersonalMaterialAssessment = { kind: "unassessed" };

/** What kind of installation state a finding caught. */
export type InstallationStateKind =
  "transcript-pointer" | "session-id" | "observed-by" | "home-path" | "machine-temp-path";

/** Fields every privacy finding carries: where it is, and the sentence a caller displays. */
interface PrivacyFindingBase {
  readonly locus: string;
  /** One-based line in the judged text. */
  readonly line: number;
  /** The whole refusal for this finding: what, where, and the fix. */
  readonly message: string;
}

/**
 * A pointer or path that belongs to this installation. Its matched text is never echoed.
 * @internal — a member of {@link PrivacyFinding}, which is what callers read.
 */
export interface PrivacyInstallationStateFinding extends PrivacyFindingBase {
  readonly code: "INSTALLATION_STATE";
  readonly kind: InstallationStateKind;
}

/**
 * A refused hygiene hit: a credential shape, a denylisted term or a forbidden identifier. Never echoed.
 * @internal — a member of {@link PrivacyFinding}, which is what callers read.
 */
export interface PrivacyHygieneFinding extends PrivacyFindingBase {
  readonly code: "HYGIENE";
  /** The hygiene gate's own label for the class that matched. */
  readonly label: string;
}

/**
 * A private term matched. Names the class only: never the term, its pattern or its source.
 * @internal — a member of {@link PrivacyFinding}, which is what callers read.
 */
export interface PrivacyPrivateTermFinding extends PrivacyFindingBase {
  readonly code: "PRIVATE_TERM";
  readonly className: PrivateTermClass;
}

/** One thing the rules refuse. */
export type PrivacyFinding = PrivacyInstallationStateFinding | PrivacyHygieneFinding | PrivacyPrivateTermFinding;

/**
 * The check's answer: every rule finding, and the personal-material assessment it carried. A caller refuses on
 * any finding or on a `refused` assessment; `unassessed` is not a refusal, and it is not a clearance either.
 * @internal — part of {@link checkPrivacy}'s contract; the write transports and the posted-text sweep import it next.
 */
export interface PrivacyVerdict {
  /** Every rule finding, in line order; empty when no rule refuses the text. */
  readonly findings: readonly PrivacyFinding[];
  readonly personalMaterial: PersonalMaterialAssessment;
}

/** The fix for each installation-state kind. */
const INSTALLATION_FIXES: Readonly<Record<InstallationStateKind, { readonly what: string; readonly fix: string }>> = {
  "home-path": {
    fix: "write a repository-relative path, or `$SLOPWEAVER_HOME/<path>` for the state home",
    what: "an absolute home path",
  },
  "machine-temp-path": { fix: "drop the machine path and name the file by its role", what: "a per-machine temp path" },
  "observed-by": {
    fix: 'drop the origin line; say what was seen, and credit "the owner" or "an agent"',
    what: "an `observed by <session>` origin",
  },
  "session-id": {
    fix: "drop the id; no published surface points back into an installation",
    what: "a session or thread id",
  },
  "transcript-pointer": {
    fix: "drop the pointer; no published surface points back into an installation",
    what: "a transcript or console-call pointer",
  },
};

/** A UUID as Claude Code, Codex and the console write one. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Each installation-state shape, judged on the whole text. */
const INSTALLATION_PATTERNS: readonly { readonly kind: InstallationStateKind; readonly re: RegExp }[] = [
  { kind: "transcript-pointer", re: /\b(?:transcript|talk-call):[0-9a-f]{8}/giu },
  {
    kind: "session-id",
    re: new RegExp(`\\b(?:session|transcript|thread|conversation|call|turn)\\b[^\\n]{0,24}?\\b${UUID}\\b`, "giu"),
  },
  {
    kind: "observed-by",
    re: /\bobserved by\s+(?:`?[A-Za-z0-9.]*[-_][\w.-]*|[^\n]{1,80}? on \d{4}-\d{2}-\d{2})/giu,
  },
  { kind: "home-path", re: /(?<![\w.])\/(?:Users|home)\/(?![<{$*])[A-Za-z0-9._-]+/gu },
  { kind: "home-path", re: /(?:~|\$HOME|\$\{HOME\})\/\.slopweaver(?![\w-])/gu },
  { kind: "machine-temp-path", re: /(?:\/private)?\/var\/folders\/|\/private\/tmp\/claude-\d+/gu },
];

/**
 * One-based line of an offset.
 *
 * @param text the text the offset indexes
 * @param offset a character offset into it
 * @returns the line it sits on
 */
export function lineAt({ text, offset }: { text: string; offset: number }): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

/** Every installation-state shape in the whole text, at most one per kind per line. */
function installationFindings({ text, locus }: { text: string; locus: string }): PrivacyInstallationStateFinding[] {
  const seen = new Set<string>();
  return INSTALLATION_PATTERNS.flatMap(({ kind, re }) =>
    [...text.matchAll(re)].flatMap((match) => {
      const line = lineAt({ offset: match.index, text });
      // A pointer carries its session id, so the two kinds are one finding per line, the pointer named.
      const family = kind === "session-id" ? "transcript-pointer" : kind;
      const key = `${family}:${String(line)}`;
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      const { fix, what } = INSTALLATION_FIXES[kind];
      return [
        {
          code: "INSTALLATION_STATE" as const,
          kind,
          line,
          locus,
          message: `${locus} line ${String(line)}: ${what} (redacted here) — ${fix}`,
        },
      ];
    }),
  );
}

/** Every refused hygiene hit: the leak classes and denylist, then the forbidden identifiers the destination does not forgive. */
function hygieneFindings({
  text,
  locus,
  destination,
  policy,
}: {
  text: string;
  locus: string;
  destination: PrivacyDestination;
  policy: PrivacyPolicy;
}): PrivacyHygieneFinding[] {
  const leaks = scanContent({ content: text, denylist: policy.denylist, path: locus })
    .filter((hit) => isRefusedHit({ label: hit.label }))
    .map((hit) => {
      const what = hit.label === DENYLIST_LABEL ? "a denylisted term" : `a ${hit.label} shape`;
      return {
        code: "HYGIENE" as const,
        label: hit.label,
        line: hit.line,
        locus,
        message: `${locus} line ${String(hit.line)}: ${what} (redacted here) — remove it`,
      };
    });
  if (destination.identifierAudience === "installation-workspace") {
    return leaks;
  }
  const identifiers = pullRequestIdentifierHits({
    content: text,
    identifiers: destination.installationIdentifiers,
    ownRepository: destination.ownRepository,
    path: locus,
    rules: policy.identifierRules,
  })
    .filter((hit) => isRefusedHit({ label: hit.kind }))
    .map((hit) => ({
      code: "HYGIENE" as const,
      label: hit.kind,
      line: hit.line,
      locus,
      message: `${locus} line ${String(hit.line)}: a ${hit.kind} identifier (redacted here) — replace it with a synthetic stand-in`,
    }));
  return [...leaks, ...identifiers];
}

/**
 * Every private-term match in one text, one entry per match, under exactly the forgiveness {@link checkPrivacy}
 * applies — what a held write records so a review can judge each match in context (`./privateTermReview/gate.ts`).
 * Offsets index the text with its line breaks as `\n`, the form the check judges. Pure.
 *
 * @param content the text exactly as it is sent
 * @param destination the facts about where it goes, which forgive a match inside the target's own address
 * @param policy the private terms
 * @returns each counting match with the row that made it, in text order
 */
export function privateTermMatchesIn({
  content,
  destination,
  policy,
}: {
  content: PrivacyContent;
  destination: PrivacyDestination;
  policy: PrivacyPolicy;
}): readonly PrivateTermMatch[] {
  const text = content.text.replace(/\r\n/gu, "\n");
  return privateTermMatches({
    forgiven: ownAddressRanges({ content: text, ownRepository: destination.ownRepository }),
    terms: policy.privateTerms,
    text,
  });
}

/**
 * Judge one text against every privacy rule, for one destination. Pure.
 *
 * @param content the text exactly as it is sent, and the locus a refusal names
 * @param destination the facts about where it goes, which the one forgiveness rule reads
 * @param policy the private denylist, the forbidden-identifier rules and the private terms
 * @param personalMaterial the assessment a visible session made, or {@link UNASSESSED_PERSONAL_MATERIAL}
 * @returns every rule finding in line order, beside the assessment carried
 */
export function checkPrivacy({
  content,
  destination,
  policy,
  personalMaterial,
}: {
  content: PrivacyContent;
  destination: PrivacyDestination;
  policy: PrivacyPolicy;
  personalMaterial: PersonalMaterialAssessment;
}): PrivacyVerdict {
  const text = content.text.replace(/\r\n/gu, "\n");
  const findings: readonly PrivacyFinding[] = [
    ...installationFindings({ locus: content.locus, text }),
    ...hygieneFindings({ destination, locus: content.locus, policy, text }),
    ...privateTermHits({
      forgiven: ownAddressRanges({ content: text, ownRepository: destination.ownRepository }),
      terms: policy.privateTerms,
      text,
    }).map(({ className, line }) => ({
      className,
      code: "PRIVATE_TERM" as const,
      line,
      locus: content.locus,
      message: `${content.locus} line ${String(line)}: ${privateTermFindingSentence({ className })}`,
    })),
  ];
  // A message a private term matches — through its locus as much as its wording — is printed as the withheld stand-in.
  const printable = findings.map((finding) => ({
    ...finding,
    message: printableUnderTerms({ line: finding.message, terms: policy.privateTerms }),
  }));
  return { findings: printable.toSorted((left, right) => left.line - right.line), personalMaterial };
}
