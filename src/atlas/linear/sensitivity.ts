/**
 * The pre-write gate: a Linear generation that carries a credential is REFUSED, not redacted. PURE.
 *
 * ## Why a second mechanism, when the selections are already an allowlist
 *
 * The inventory (`settingSurfaces.ts`) asks for named fields only, so a secret cannot arrive through a field
 * nobody selected. That is the primary mechanism and it is a good one. This is the second, and it exists
 * because the first is a property of a table a person maintains: the day somebody adds `webhooks { secret }`
 * to that table for a good-looking reason, the only thing standing between it and disk is a check that does not
 * read the table. The 1Password atlas is built the same way for the same reason — three independent mechanisms,
 * so no single mistake defeats all of them.
 *
 * ## What it does NOT claim, stated rather than discovered
 *
 * This gate recognises a credential by the NAME its field or parameter carries, so a credential named
 * something nobody would call a credential passes it. That is a real residue and no heuristic removes it —
 * which is exactly why the PRIMARY mechanism is `settingSurfaces.ts`'s explicit selections plus `settings.ts`'s
 * pruning that enforces them, and why this file is the second mechanism rather than the first. A Codex review
 * pass made the point twice, with `feedToken` and then with a path-embedded token; both are now caught, and the
 * class is unbounded.
 *
 * ## It refuses rather than redacting
 *
 * A redacting gate leaves a generation that is silently different from what was read, which is the class of
 * failure the whole data-integrity ruling is about. A refusal leaves nothing half-written and names the
 * exact path, so the person who added the field fixes the table rather than discovering months later that
 * the atlas has been quietly dropping things.
 */

/**
 * Field names whose VALUE is a credential wherever it appears in a Linear payload.
 *
 * Every one of these is a real field on a type this atlas reads — `settings.ts`'s header explains each and
 * why it is not selected. Matching is on the key's own name at any depth, case-insensitively, because a
 * nested selection puts the same field one level down without renaming it.
 * @internal
 */
export const LINEAR_DENIED_FIELD_NAMES: readonly string[] = [
  "aiproviderconfiguration",
  "authsettings",
  "calendarhash",
  "cyclecalenderurl",
  "samlsettings",
  "scimsettings",
  "secret",
  "securitysettings",
];

/**
 * Value shapes that are a credential whatever field they arrive under.
 *
 * Deliberately narrow. A pattern that fired on anything long and random would refuse a generation for every
 * UUID Linear returns, and a gate that cries wolf is a gate somebody turns off.
 */
const CREDENTIAL_SHAPED = [
  /** Linear's own personal API key prefix. */
  /^lin_api_[A-Za-z0-9]{20,}$/,
  /** Linear's OAuth access token prefix. */
  /^lin_oauth_[A-Za-z0-9]{20,}$/,
  /** A PEM private key of any flavour. */
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * One reason a generation may not be published.
 * @internal
 */
export interface SensitivityHit {
  /** The dotted path the offending value sits at, so the fix is findable. */
  readonly path: string;
  /** Why it was refused — a denied field name, or a credential-shaped value. */
  readonly reason: string;
}

/**
 * Words that name a credential wherever they appear in a URL's parameter names or path segments.
 *
 * Matched as SUBSTRINGS of a segment, because a fixed list of exact names is a guess about what a provider
 * will call its own field — and two Codex review passes broke exactly that guess, first with `feedToken` and
 * then with a token in the path rather than the query.
 */
const CREDENTIAL_WORDS = [
  "token",
  "secret",
  "passwd",
  "password",
  "apikey",
  "api_key",
  "accesskey",
  "access_key",
  "auth",
  "signature",
];

/**
 * Short abbreviations that name a credential only as a WHOLE segment.
 *
 * Kept apart from {@link CREDENTIAL_WORDS} because matching them as substrings would be absurd: `sig`
 * appears in `design` and `key` in `keyword`, so a substring rule on either would refuse ordinary URLs and
 * teach a reader to ignore this gate.
 */
const CREDENTIAL_ABBREVIATIONS = new Set(["sig", "key", "pw", "psk"]);

/** What an opaque path segment looks like — a run of URL-safe characters and nothing else. */
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** How long an opaque value must be before it is treated as a credential rather than a flag. */
const CREDENTIAL_VALUE_MIN = 8;

/** Whether one segment names a credential — as a substring for a real word, exactly for an abbreviation. */
function namesCredential({ segment }: { segment: string }): boolean {
  const lowered = segment.toLowerCase();
  return CREDENTIAL_WORDS.some((word) => lowered.includes(word)) || CREDENTIAL_ABBREVIATIONS.has(lowered);
}

/**
 * Whether a URL carries a credential in its query string or its path.
 *
 * PARSED rather than pattern-matched, and that is the point: the regex this replaced had two unbounded
 * quantifiers either side of a variable segment, which `redos-check` correctly refused as polynomial
 * backtracking. `URL` does the parsing in one pass with no backtracking at all, and the check it enables is
 * both cheaper and more exact — real parameter names and real path segments rather than a guess at their
 * spelling.
 *
 * @param value the string to judge
 * @returns `true` when it is a URL carrying a credential
 */
function isCredentialBearingUrl({ value }: { value: string }): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  // The FRAGMENT is read alongside the query string, and a Codex review pass is why: an OAuth implicit-flow
  // callback carries `#access_token=…`, which is a credential in every sense and appears in no `searchParams`.
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  for (const [name, parameter] of [...url.searchParams, ...fragment]) {
    if (parameter.length >= CREDENTIAL_VALUE_MIN && namesCredential({ segment: name })) {
      return true;
    }
  }
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  return segments.some((segment, index) => {
    const next = segments[index + 1];
    if (next === undefined) {
      return false;
    }
    return namesCredential({ segment }) && next.length >= CREDENTIAL_VALUE_MIN + 4 && OPAQUE_SEGMENT.test(next);
  });
}

/** Whether one string is credential-shaped, by any of the narrow patterns above. */
function isCredentialShaped({ value }: { value: string }): boolean {
  return CREDENTIAL_SHAPED.some((pattern) => pattern.test(value)) || isCredentialBearingUrl({ value });
}

/** Walk one object's own keys, refusing a denied field name before descending into its value. */
function walkObject({ value, path, hits }: { value: object; path: string; hits: SensitivityHit[] }): void {
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (LINEAR_DENIED_FIELD_NAMES.includes(key.toLowerCase())) {
      hits.push({ path: childPath, reason: `\`${key}\` is a field whose value this atlas may never hold` });
      continue;
    }
    walk({ hits, path: childPath, value: child });
  }
}

/** Walk one value, collecting every hit. Depth is unbounded on purpose: so is a nested selection. */
function walk({ value, path, hits }: { value: unknown; path: string; hits: SensitivityHit[] }): void {
  if (typeof value === "string") {
    if (isCredentialShaped({ value })) {
      hits.push({ path, reason: "the value has the shape of a credential" });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      walk({ hits, path: `${path}[${String(index)}]`, value: entry });
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    walkObject({ hits, path, value });
  }
}

/**
 * Every reason one generation may not be published.
 *
 * @param generation whatever is about to be written — a kind file, a manifest, or the whole set
 * @returns the hits, in the order they were found; empty when the generation may be published
 */
export function sensitivityHits({ generation }: { generation: unknown }): readonly SensitivityHit[] {
  const hits: SensitivityHit[] = [];
  walk({ hits, path: "", value: generation });
  return hits;
}
