/**
 * The publication scan: one deterministic check over every text a pull request publishes — its title, its
 * description, a self-review comment, a commit message, an image caption, and the text visible in a captured
 * frame — refusing what the attribution rule and the hygiene gate both forbid, in one call.
 *
 * ## What it refuses
 *
 * - **First person.** `I`, `me`, `my`, `we`, `our` and `us`, whole-word and case-insensitive, in the author's
 *   PROSE only (`./publicationProse.ts` blanks code, link targets and quotations first). "We" goes too: it is
 *   what hid who did a thing. The owner is "the owner"; a one-off act names "the owner" or "an agent".
 * - **Host wording.** "this Mac" meaning the machine Slopweaver runs on is "this machine". macOS, Keychain,
 *   Spotlight and APFS are product names and stay. Prose only, like first person.
 * - **Everything the outbound privacy check refuses** (`./privacyCheck.ts`): installation state — session and
 *   transcript ids, `transcript:` pointers, home and temp paths — the installation's private terms, and the hygiene gate's own refusals, through
 *   the same `scanContent` and `pullRequestIdentifierHits` the PR door runs in `scanPrMetadataLeaks`, with the
 *   same private denylist. Those rules are every destination's; first person and host wording are the two this
 *   scan adds because they are a pull request author's rules. Nothing matched is ever echoed.
 *
 * Captured frame text is a quotation of a SCREEN — somebody else's message, the operating system's own dialog —
 * so only the privacy check applies to it; first person and host wording are the author's rules.
 *
 * ## What it deliberately does not judge
 *
 * Whether an act credited to the owner has a record behind it, and whether an opinion is hedged, need judgement.
 * They belong to the fresh description review, and this scanner does not pretend to prove them.
 *
 * There is no override. Each finding names the fix, and every fix is a rewording that is always possible.
 */
import { FORBIDDEN_IDENTIFIER_RULES } from "../hygiene/forbiddenIdentifiers.js";
import type { ForbiddenIdentifierRules } from "../hygiene/identifierScan.js";
import type { InstallationIdentifiers } from "../hygiene/installationIdentifiers.js";
import { type PrivateTerm, type PrivateTermClass, printableUnderTerms } from "../hygiene/privateTerms.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  checkPrivacy,
  type InstallationStateKind,
  lineAt,
  type PrivacyFinding,
  UNASSESSED_PERSONAL_MATERIAL,
} from "./privacyCheck.js";
import { publicationProseMask } from "./publicationProse.js";

/**
 * Every surface a pull request publishes text on. Closed: a new surface is a new member, never a free string.
 */
export type PublicationSurface =
  "title" | "description" | "self-review-comment" | "commit-message" | "image-caption" | "frame-text" | "pixel-text";

/** How each surface is named in a refusal. */
const SURFACE_LABELS: Readonly<Record<PublicationSurface, string>> = {
  "commit-message": "commit message",
  description: "PR description",
  "frame-text": "captured frame text",
  "image-caption": "image caption",
  "pixel-text": "text read from the picture's pixels",
  "self-review-comment": "self-review comment",
  title: "PR title",
};

/**
 * The surfaces whose prose is a quotation of a screen rather than authored, so wording rules skip them: the text a
 * capture verb recorded, and the text recognised in the pixels themselves.
 */
const QUOTED_SURFACES: ReadonlySet<PublicationSurface> = new Set(["frame-text", "pixel-text"]);

/** Fields every finding carries: where it is, and the sentence a caller displays. */
interface FindingBase {
  readonly surface: PublicationSurface;
  /** One-based line in the scanned text. */
  readonly line: number;
  /** The whole refusal for this finding: what, where, and the fix. */
  readonly message: string;
}

/**
 * A first-person pronoun in authored prose.
 * @internal — a member of {@link PublicationFinding}, which is what callers read.
 */
export interface FirstPersonFinding extends FindingBase {
  readonly code: "FIRST_PERSON";
  /** The pronoun as written. */
  readonly word: string;
}

/**
 * A pointer or path that belongs to this installation. Its matched text is never echoed.
 * @internal — a member of {@link PublicationFinding}, which is what callers read.
 */
export interface InstallationStateFinding extends FindingBase {
  readonly code: "INSTALLATION_STATE";
  readonly kind: InstallationStateKind;
}

/**
 * "this Mac" meaning the host machine.
 * @internal — a member of {@link PublicationFinding}, which is what callers read.
 */
export interface HostWordingFinding extends FindingBase {
  readonly code: "HOST_WORDING";
}

/**
 * A refused hygiene hit: a credential shape, a denylisted term or a forbidden identifier. Never echoed.
 * @internal — a member of {@link PublicationFinding}, which is what callers read.
 */
export interface HygieneFinding extends FindingBase {
  readonly code: "HYGIENE";
  /** The hygiene gate's own label for the class that matched. */
  readonly label: string;
}

/**
 * A private term matched (`../hygiene/privateTerms.ts`). Names the class only, never the term.
 * @internal — a member of {@link PublicationFinding}, which is what callers read.
 */
export interface PrivateTermFinding extends FindingBase {
  readonly code: "PRIVATE_TERM";
  readonly className: PrivateTermClass;
}

/** One thing the scan refuses. */
export type PublicationFinding =
  FirstPersonFinding | InstallationStateFinding | HostWordingFinding | HygieneFinding | PrivateTermFinding;

/**
 * The scan's one failure: the text carries at least one finding.
 * @internal — only this module and its tests name the type until the description gate wires the scan in.
 */
export interface PublicationRefusedError {
  readonly code: "PUBLICATION_REFUSED";
  readonly surface: PublicationSurface;
  /** How the surface is printed: its label, or the withheld stand-in when a private term matches the label. */
  readonly label: string;
  /** Every finding, in line order; never empty. */
  readonly findings: readonly PublicationFinding[];
  readonly message: string;
}

/**
 * The publication scan's error union.
 * @internal — only this module and its tests name the type until the description gate wires the scan in.
 */
export type PublicationScanError = PublicationRefusedError;

/**
 * Factories for {@link PublicationScanError}.
 * @internal — only this module and its tests build one until the description gate wires the scan in.
 */
export const PublicationScanErrors = {
  refused: ({
    surface,
    findings,
    privateTerms,
  }: {
    surface: PublicationSurface;
    findings: readonly PublicationFinding[];
    privateTerms: readonly PrivateTerm[];
  }): PublicationRefusedError => {
    const label = printableUnderTerms({ line: SURFACE_LABELS[surface], terms: privateTerms });
    return {
      code: "PUBLICATION_REFUSED",
      findings,
      label,
      message: `${label} refused: ${findings.map((finding) => finding.message).join("; ")}`,
      surface,
    };
  },
} as const;

/** The fix every first-person finding names. */
const FIRST_PERSON_FIX = 'name who acted — "the owner", or "an agent" for a session — or say what the change does';

/**
 * A first-person pronoun: whole word, case-insensitive, never part of a path, flag, handle, compound or
 * identifier. An apostrophe AFTER it is allowed, so a contraction (`I'm`, `we're`) is still first person.
 */
const FIRST_PERSON = /(?<![\p{L}\p{N}_\-/.@#$&])(?:i|me|my|we|our|us)(?![\p{L}\p{N}_\-/])/giu;

/** "this Mac", whole word. */
const HOST_WORDING = /(?<![\p{L}\p{N}_])this\s+mac(?![\p{L}\p{N}_])/giu;

/**
 * Whether a pronoun-shaped match is really an abbreviation, an address or an enumerator: `i.e.`, `us.gov`, `i)`.
 *
 * @returns true when the match is not a pronoun
 */
function notAPronoun({ prose, word, end }: { prose: string; word: string; end: number }): boolean {
  const next = prose[end];
  const afterDot = end + 1 < prose.length ? prose[end + 1]! : "";
  if (next === "." && /[\p{L}\p{N}]/u.test(afterDot)) {
    return true;
  }
  return word === "i" && next === ")";
}

/** Every first-person pronoun in the prose mask. */
function firstPersonFindings({ prose, surface }: { prose: string; surface: PublicationSurface }): FirstPersonFinding[] {
  return [...prose.matchAll(FIRST_PERSON)]
    .filter((match) => !notAPronoun({ end: match.index + match[0].length, prose, word: match[0] }))
    .map((match) => {
      const line = lineAt({ offset: match.index, text: prose });
      return {
        code: "FIRST_PERSON" as const,
        line,
        message: `${SURFACE_LABELS[surface]} line ${String(line)}: "${match[0]}" is first person — ${FIRST_PERSON_FIX}`,
        surface,
        word: match[0],
      };
    });
}

/** Every "this Mac" in the prose mask. */
function hostWordingFindings({ prose, surface }: { prose: string; surface: PublicationSurface }): HostWordingFinding[] {
  return [...prose.matchAll(HOST_WORDING)].map((match) => {
    const line = lineAt({ offset: match.index, text: prose });
    return {
      code: "HOST_WORDING" as const,
      line,
      message: `${SURFACE_LABELS[surface]} line ${String(line)}: "${match[0]}" names the host by its make — write "this machine"`,
      surface,
    };
  });
}

/** The hygiene context: the private denylist and what the identifier half forgives. */
export interface PublicationHygiene {
  /** The private denylist (`loadDenylist`); empty still catches every credential shape. */
  readonly denylist: readonly string[];
  /** The private terms (`../hygiene/privateTerms.ts`), required so no caller can leave them out by omission. */
  readonly privateTerms: readonly PrivateTerm[];
  /** The target repository, `owner/repo`, which the identifier half does not count. */
  readonly ownRepository?: string | undefined;
  /** The installation's own identifiers, given only on an installation's own repository. */
  readonly installationIdentifiers?: InstallationIdentifiers | undefined;
  /** The forbidden-identifier rules; the committed ones unless a test injects synthetic ones. */
  readonly identifierRules?: ForbiddenIdentifierRules | undefined;
}

/**
 * Every privacy finding (`./privacyCheck.ts`), under the surface it was scanned as. The privacy check reports a
 * locus; this scan's findings carry the surface instead, so its callers and its refusal text are unchanged.
 */
function privacyFindingsOf({
  text,
  surface,
  hygiene,
}: {
  text: string;
  surface: PublicationSurface;
  hygiene: PublicationHygiene;
}): (InstallationStateFinding | HygieneFinding | PrivateTermFinding)[] {
  const { identifierRules = FORBIDDEN_IDENTIFIER_RULES } = hygiene;
  const verdict = checkPrivacy({
    content: { locus: SURFACE_LABELS[surface], text },
    destination: {
      identifierAudience: "strict",
      installationIdentifiers: hygiene.installationIdentifiers,
      ownRepository: hygiene.ownRepository,
    },
    personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
    policy: { denylist: hygiene.denylist, identifierRules, privateTerms: hygiene.privateTerms },
  });
  return verdict.findings.map((finding: PrivacyFinding) => {
    const base = { line: finding.line, message: finding.message, surface };
    if (finding.code === "HYGIENE") {
      return { ...base, code: finding.code, label: finding.label };
    }
    if (finding.code === "PRIVATE_TERM") {
      return { ...base, className: finding.className, code: finding.code };
    }
    return { ...base, code: finding.code, kind: finding.kind };
  });
}

/**
 * Every finding in one published text, in line order. Pure.
 *
 * @param text the text exactly as it will be published
 * @param surface where it is published, which decides the label and whether the wording rules apply
 * @param hygiene the private denylist and the identifier half's forgiveness for this target
 * @returns every finding, empty when the text may be published
 */
export function publicationFindings({
  text,
  surface,
  hygiene,
}: {
  text: string;
  surface: PublicationSurface;
  hygiene: PublicationHygiene;
}): readonly PublicationFinding[] {
  const normalised = text.replace(/\r\n/gu, "\n");
  const authored = !QUOTED_SURFACES.has(surface);
  const prose = authored ? publicationProseMask({ text: normalised }) : "";
  const findings: readonly PublicationFinding[] = [
    ...(authored ? firstPersonFindings({ prose, surface }) : []),
    ...(authored ? hostWordingFindings({ prose, surface }) : []),
    ...privacyFindingsOf({ hygiene, surface, text: normalised }),
  ];
  // The privacy findings arrive printable already; the author's rules print the surface label, which a term can match.
  return findings
    .map((finding) => ({
      ...finding,
      message: printableUnderTerms({ line: finding.message, terms: hygiene.privateTerms }),
    }))
    .toSorted((left, right) => left.line - right.line);
}

/**
 * Scan one published text and refuse it when anything in it may not be published.
 *
 * @param text the text exactly as it will be published
 * @param surface where it is published — a title, a description, a self-review comment, a commit message, an
 *   image caption, or the text visible in a captured frame
 * @param hygiene the private denylist and the identifier half's forgiveness for this target
 * @returns ok when the text may be published, or the refusal carrying every finding
 * @internal — the description gate is its first caller and is wired next; until then only tests call it.
 */
export function scanPublication({
  text,
  surface,
  hygiene,
}: {
  text: string;
  surface: PublicationSurface;
  hygiene: PublicationHygiene;
}): Result<void, PublicationScanError> {
  const findings = publicationFindings({ hygiene, surface, text });
  return findings.length === 0
    ? ok(undefined)
    : err(PublicationScanErrors.refused({ findings, privateTerms: hygiene.privateTerms, surface }));
}

/**
 * The lines a verb prints for a refusal: what was refused, one line per finding, and that there is no override.
 *
 * @param error the refusal
 * @param subject what the text belongs to, for the first line (`commit <sha>`, `comments[2].body`)
 * @returns the lines, in order
 * @internal — the description gate is its first caller and is wired next; until then only tests call it.
 */
export function publicationRefusalLines({
  error,
  subject,
}: {
  error: PublicationScanError;
  subject: string;
}): readonly string[] {
  return [
    `refused: ${subject} (${error.label}) cannot be published as written:`,
    ...error.findings.map((finding) => `  ${finding.message}`),
    "  This is a hold, with no override: reword the text, then run the command again.",
  ];
}

/**
 * How a surface is named in a refusal.
 *
 * @returns the surface's display label
 * @internal — the description gate is its first caller and is wired next; until then only tests call it.
 */
export function publicationSurfaceLabel({ surface }: { surface: PublicationSurface }): string {
  return SURFACE_LABELS[surface];
}
