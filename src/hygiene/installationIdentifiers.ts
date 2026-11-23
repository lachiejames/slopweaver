/**
 * The installation's OWN identifiers, which a pull request on one of the installation's repositories may carry —
 * the pure half: the value, and the filter that forgives a hit only when every span behind it is one of them.
 *
 * Why this exists, measured: an installation repository's own CI demands its Linear ticket in a pull
 * request's title, and the write door refused that exact title as `forbidden-team-key`, because the
 * forbidden-identifier rules name the installation's own team key. A rule that keeps an installation's names out
 * of THIS public source tree has no business keeping them out of the installation's own repository. So the write
 * door (`../cli/commands/github/performWrite.ts`) passes this value for a pull request whose repository is neither
 * this build's own nor its public source address; the CI gate (`../devGate/devGate.ts`) never does, and nor does
 * the repository-content scan, so both stay exactly as strict as before.
 *
 * The values are resolved from the install's own state at the verb's shell
 * (`../outbound/github/installationIdentifiersRead.ts`), never a constant and never git. The credential half
 * of the scan (`./scan.ts`'s `scanContent`) never sees this value: a secret is refused on every repository.
 *
 * ## The criterion: every span on the line, of the hit's kind, is own
 *
 * `scan` reports one hit per `line:kind` occurrence it finds and carries no text, while `spans` reports every
 * exact window with its offset. So a hit is forgiven only when the spans of its kind on its line are non-empty
 * and EVERY one of them is own. One foreign span of the same kind on the same line keeps the line refused — the
 * refusal then also covers the own occurrence, which costs nothing because it echoes no matched text.
 *
 * A span is own when:
 *
 * - a team key (`ABC-123`): the key before the first `-` is one of {@link InstallationIdentifiers.linearTeamKeys};
 * - a provider location: the workspace label (the scanner spans the label alone) is one of
 *   {@link InstallationIdentifiers.providerLocationLabels};
 * - any other kind: the exact span text, lowercased, is one of {@link InstallationIdentifiers.personNames}. A name
 *   is never split into first name and surname, which would turn a common first name into a broad exemption.
 */
import { type ForbiddenIdentifierRules, type IdentifierHit, identifierScanner } from "./identifierScan.js";
import { identifierHitsBesideOwnRepository, ownAddressRanges } from "./ownRepository.js";

/** The installation's own identifiers, as the write door forgives them off this build's own repositories. */
export interface InstallationIdentifiers {
  /** The installation's Linear team keys, uppercase (`ABC`). */
  readonly linearTeamKeys: readonly string[];
  /** The installation's own provider workspace labels, lowercase (`acme` in `linear.app/acme`). */
  readonly providerLocationLabels: readonly string[];
  /** The installation's people, lowercase, exactly as the install names them. */
  readonly personNames: readonly string[];
}

/**
 * Build the value from raw lists: trimmed, empties dropped, each list case-normalised, deduplicated and sorted, so
 * two reads of the same state compare equal. Pure.
 *
 * @param linearTeamKeys team keys in any case
 * @param providerLocationLabels workspace labels in any case
 * @param personNames people's names in any case
 * @returns the normalised value
 */
export function installationIdentifiersOf({
  linearTeamKeys,
  providerLocationLabels,
  personNames,
}: {
  linearTeamKeys: readonly string[];
  providerLocationLabels: readonly string[];
  personNames: readonly string[];
}): InstallationIdentifiers {
  const normalised = ({ values, upper }: { values: readonly string[]; upper: boolean }): readonly string[] => {
    const cased = values
      .map((value) => value.trim())
      .map((value) => (upper ? value.toUpperCase() : value.toLowerCase()));
    return [...new Set(cased.filter((value) => value !== ""))].toSorted();
  };
  return {
    linearTeamKeys: normalised({ upper: true, values: linearTeamKeys }),
    personNames: normalised({ upper: false, values: personNames }),
    providerLocationLabels: normalised({ upper: false, values: providerLocationLabels }),
  };
}

/**
 * A pull request's identifier hits: its own repository's address uncounted ({@link identifierHitsBesideOwnRepository}),
 * then the installation's own identifiers forgiven. Given identifiers, the WHOLE own address goes uncounted rather
 * than only its owner, because on an installation's own repository its name is the installation's too. Pure.
 *
 * @param content the scanned text
 * @param path the identity the hits are reported under
 * @param rules the forbidden-identifier rules
 * @param ownRepository the pull request's own `owner/repo`
 * @param identifiers the installation's own identifiers, or undefined on a repository that forgives none
 * @returns the hits still refused, in order
 */
export function pullRequestIdentifierHits({
  content,
  path,
  rules,
  ownRepository,
  identifiers,
}: {
  content: string;
  path: string;
  rules: ForbiddenIdentifierRules;
  ownRepository: string | undefined;
  identifiers: InstallationIdentifiers | undefined;
}): readonly IdentifierHit[] {
  const wholeAddress = identifiers !== undefined;
  const hits = identifierHitsBesideOwnRepository({ content, ownRepository, path, rules, wholeAddress });
  return identifierHitsBesideInstallationIdentifiers({ content, hits, identifiers, ownRepository, rules });
}

/**
 * The hits left counting once the installation's own identifiers are forgiven. Pure.
 *
 * A span lying wholly inside an exact-case occurrence of the pull request's own address ({@link ownAddressRanges})
 * is that address, which the own-repository pass already forgave, so it never counts as foreign here: without that,
 * `https://github.com/acme/ABC-3 XYZ-12` on `acme/ABC-3` kept the own `XYZ-12` refused.
 *
 * @param content the scanned text the hits came from
 * @param hits the hits already found in `content`, after any own-repository forgiveness
 * @param identifiers the installation's own identifiers, or undefined to forgive nothing
 * @param ownRepository the pull request's own `owner/repo` the hits were already forgiven beside
 * @param rules the forbidden-identifier rules the hits were found with
 * @returns the hits still refused, in order
 */
export function identifierHitsBesideInstallationIdentifiers({
  content,
  hits,
  identifiers,
  ownRepository,
  rules,
}: {
  content: string;
  hits: readonly IdentifierHit[];
  identifiers: InstallationIdentifiers | undefined;
  ownRepository: string | undefined;
  rules: ForbiddenIdentifierRules;
}): readonly IdentifierHit[] {
  if (identifiers === undefined || hits.length === 0) {
    return hits;
  }
  const starts = lineStarts({ content });
  const addresses = ownAddressRanges({ content, ownRepository });
  const foreign = new Set<string>();
  const seen = new Set<string>();
  for (const span of identifierScanner({ rules }).spans({ content })) {
    const end = span.offset + span.length;
    if (addresses.some((address) => address.start <= span.offset && end <= address.end)) {
      continue;
    }
    const key = `${String(lineOf({ offset: span.offset, starts }))}:${span.kind}`;
    seen.add(key);
    const text = content.slice(span.offset, end);
    if (!isOwnSpan({ identifiers, kind: span.kind, text })) {
      foreign.add(key);
    }
  }
  return hits.filter(({ kind, line }) => {
    const key = `${String(line)}:${kind}`;
    return !seen.has(key) || foreign.has(key);
  });
}

/**
 * Whether one span's text is one of the installation's own identifiers, judged by its kind.
 *
 * @param identifiers the installation's own identifiers
 * @param kind the span's identifier kind
 * @param text the exact text the span covers
 * @returns true when it is own
 */
function isOwnSpan({
  identifiers,
  kind,
  text,
}: {
  identifiers: InstallationIdentifiers;
  kind: IdentifierHit["kind"];
  text: string;
}): boolean {
  if (kind === "forbidden-team-key") {
    return identifiers.linearTeamKeys.includes(text.slice(0, text.indexOf("-")).toUpperCase());
  }
  if (kind === "forbidden-provider-location") {
    return identifiers.providerLocationLabels.includes(text.toLowerCase());
  }
  return identifiers.personNames.includes(text.toLowerCase());
}

/**
 * The offset each line starts at.
 *
 * @param content the text
 * @returns the offsets, the first always 0
 */
function lineStarts({ content }: { content: string }): readonly number[] {
  const starts = [0];
  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * The 1-based line an offset sits on.
 *
 * @param offset the offset
 * @param starts every line's start offset
 * @returns the line
 */
function lineOf({ offset, starts }: { offset: number; starts: readonly number[] }): number {
  return starts.filter((start) => start <= offset).length;
}
