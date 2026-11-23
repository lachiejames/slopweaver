/**
 * The ALLOWLIST redactor for a turn REPLAY FIXTURE — what makes a failed turn's own files safe to commit.
 *
 * A frozen fixture is git-tracked, so the public hygiene gate (`../../../hygiene/scan.ts`) and the private
 * denylist both scan it on every push. That is the floor, not the design. The design is the one
 * `../../../__tests__/cassetteRedact.ts` already settled for recorded HTTP: **blank every string leaf unless
 * its key is allowlisted**, because a field nobody anticipated is exactly the field that leaks. The earlier
 * denylist-shaped cassette scrub let unanticipated fields through; a turn's record set carries the same class of content —
 * a colleague's question, a worker's rationale, a reviewer's quoted evidence — and none of it is what a
 * replay assertion reads.
 *
 * What a replay assertion DOES read is structure: which lifecycle kinds were recorded, which tier, which
 * lease, which ids the answer mentions, how many review rounds ran. All of that is in {@link KEEP_KEYS},
 * and every one of those kept strings is still scrubbed by {@link redactFixtureText} on the way out.
 *
 * Pure: the caller threads the id map, and gets the grown map back. Nothing here reads a file or a clock.
 */
import { INVALID_DATADOG_CONSOLE_HOSTS } from "../../../datadog/invalidConsoleHost.js";
import { isRecord } from "../../../lib/parsers.js";

/**
 * The placeholder a frozen absolute path under `$SLOPWEAVER_HOME` becomes.
 *
 * A fixture has to be relocatable — it is materialised into a throwaway temp home at replay time — and it
 * must carry no absolute home path, a leak class the freeze's own scan refuses outright, since it refuses
 * every hit. One token
 * settles both: the freeze writes it, `./materialise.ts` substitutes the real temp home back in.
 */
export const HOME_PLACEHOLDER = "${SLOPWEAVER_HOME}";

/** What a blanked string leaf becomes — the same marker the cassette redactor uses, for the same reason. */
export const REDACTED = "[REDACTED]";

/**
 * What a blanked URL becomes: still URL-shaped, so a `z.url()` field survives the round trip.
 *
 * @internal
 */
export const REDACTED_URL = "https://redacted.invalid/[REDACTED]";

/**
 * The keys whose STRING values survive a freeze — structure, identity, time, paths, digests and enums.
 *
 * Read this list as the answer to "what could a replay assertion possibly need?", never as "what looks
 * harmless". Everything absent from it is blanked, including keys that are obviously fine today
 * (`authorSession`, `askPermalink`), because the whole point of an allowlist is that tomorrow's new field
 * is redacted before anybody notices it exists.
 *
 * Numbers, booleans and nulls are kept regardless — a count, a round number or a schema version cannot
 * carry a name, and blanking them would break every parse downstream.
 *
 * @internal
 */
export const KEEP_KEYS: ReadonlySet<string> = new Set([
  "answerDigest",
  "answerPath",
  "answerTs",
  "briefPath",
  "capabilityId",
  "channel",
  "citationId",
  "code",
  "confidence",
  "contentHash",
  "cwd",
  "dispatchId",
  // A checkpoint log row's own `draft-<digest>.json` basename. Added with the draft checkpoint itself:
  // without it the freeze copies a turn's drafts AND their log and blanks the field that joins the two, so
  // the fixture holds files nothing can name. The value is derived from a digest and can carry nothing else.
  "draftFile",
  "effect",
  "host",
  "indexStyle",
  "kind",
  "leaseExpiresAt",
  "messageTs",
  "minedAt",
  "mode",
  "model",
  // A failed or held turn's notice card, which a later answer reaps (`../earlierCards.ts`). A Slack ts can
  // carry nothing, and blanked it would make the frozen completion name a card that is not there.
  "noticeTs",
  "packetPath",
  "person",
  "queueId",
  "recordedAtIso",
  // A detective wave record's report path, kept for the reason `briefPath` is: a home path the id mapper has
  // already made synthetic, so the frozen wave.json still says where each report lived.
  "reportPath",
  "requirement",
  "response",
  "sessionName",
  "sourceClass",
  "sourceHash",
  "sourceManifestHash",
  "spawnedAt",
  "supervisorHost",
  "surface",
  "surfaceId",
  "surfaceRef",
  // A measurement's own instant (`../../../outbound/assistant/measuredFigures.ts`). An ISO datetime can
  // carry nothing, and blanked it makes the frozen answer fail `z.iso.datetime()` — the same breakage the
  // review-verdict enums below record. `repro` is deliberately NOT here: it is a whole command line, and
  // nothing in a replay reads it, so the conservative default costs nothing.
  "takenAtIso",
  "threadTs",
  "tier",
  "truthMode",
  "tsIso",
  "turnId",
  "type",
  "userId",
  "verdictPath",
  "workingTs",
  "workspaceId",
  "workspaceRef",
]);

/**
 * Keys whose value DECIDES whether the string survives — the value-scoped half of the allowlist.
 *
 * Every entry exists for a mechanical reason rather than a judgement. A citation's `label` must match `[1]`
 * and its `id` must be the number every chip in the card cites, or the answer form refuses to parse — while
 * every other `label` and `id` in the same document is prose or an installation-minted capability name. One
 * key, two populations, and only the value tells them apart. `../../../__tests__/cassetteRedact.ts` reached
 * the same shape for Gmail's `id`, and this is deliberately the NARROW direction: a numeric citation key
 * carries nothing, and anything else falls straight through to being blanked.
 *
 * A REVIEW VERDICT's enums (`../../../admit/reviewVerdict.ts`) are here for exactly that reason, and
 * they belong in the value-scoped half rather than {@link KEEP_KEYS} because each is one word from a closed
 * vocabulary while the same key elsewhere could hold anything. Measured: the
 * `rewrite-after-clean-verdict-loses-the-lease` freeze blanked `outcome`, `impact` and `support`, which made
 * the frozen verdict fail `readReviewVerdict` outright — so the one file a replay about a review verdict has
 * to read was unreadable, and no assertion could tell a `clean` round from a `broken` one.
 *
 * An answer's `figures` is here for the same mechanical reason and would break the same way. A figure is a
 * digit run with optional thousands commas, an optional decimal tail and an optional percent sign and can carry nothing; blanked, every
 * entry in a frozen answer's `measurements` names a figure the answer no longer asserts, so
 * `unusedMeasurementIssues` refuses the replay of any answer that measured anything.
 */
const KEEP_WHEN_VALUE_MATCHES: ReadonlyMap<string, RegExp> = new Map([
  ["label", /^\[\d+\]$/],
  ["id", /^\d+$/],
  ["outcome", /^(?:clean|broken|incomplete)$/],
  ["impact", /^(?:high|low)$/],
  ["support", /^(?:supported|unsupported|unverifiable)$/],
  ["restsOn", /^(?:answer|live)$/],
  ["figures", /^\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/],
]);

/**
 * Keys whose values are URLs. Blanked like anything else, but to {@link REDACTED_URL} rather than
 * {@link REDACTED}: several outbound form fields are `z.url()`, so a plain marker would make the frozen
 * answer unparseable by the very code the replay runs.
 *
 * @internal
 */
export const URL_KEYS: ReadonlySet<string> = new Set(["askPermalink", "permalink", "url"]);

/**
 * The workspace host a redacted Slack permalink keeps.
 *
 * A permalink's HOST is the workspace domain, which is an org identifier and must go; its PATH is
 * `/archives/<channel>/p<ts>`, which the id mapper has already made synthetic. Blanking the whole URL to
 * `redacted.invalid` is what a first pass did, and a dispatch record redacted that way will not parse:
 * `../../slack/permalink.ts` requires a `.slack.com` host, so the fixture became unreadable by the very
 * stores a replay drives it through. Keeping a neutral Slack host preserves the shape and reveals nothing —
 * the same trade `../../../__tests__/cassetteRedact.ts` makes with its public-origin allowlist.
 */
const FIXTURE_SLACK_HOST = "fixture.slack.com";

/**
 * The banned Datadog console hosts a redacted URL keeps, so an incident about one can be frozen.
 *
 * Every one is `app.<site>` for a site whose console lives elsewhere (`../../../datadog/invalidConsoleHost.ts`),
 * derived from Datadog's own public site table: a vendor fact, true on every install, and no org identifier. The
 * PATH is still blanked — a monitor id is the org's own. Without this, the freeze turned the dead host a turn
 * really posted into `redacted.invalid`, and a replay of that incident had nothing left to refuse.
 */
const KEPT_DEAD_DATADOG_HOSTS: ReadonlySet<string> = new Set(
  INVALID_DATADOG_CONSOLE_HOSTS.map(({ invalidHost }) => invalidHost),
);

/**
 * Redact one URL: a Slack permalink keeps its shape on a neutral host, a banned Datadog console host keeps its
 * host, and anything else is blanked whole.
 *
 * @param value the URL as it appears on disk
 * @param ids the working id map, extended in place
 * @param home the live home to rewrite out of the path
 * @param denylist the private org-word list
 * @returns the redacted URL
 */
function redactUrlValue({
  value,
  ids,
  home,
  denylist,
}: {
  value: string;
  ids: FixtureIdMap;
  home: string;
  denylist: readonly string[];
}): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return REDACTED_URL;
  }
  if (KEPT_DEAD_DATADOG_HOSTS.has(parsed.hostname)) {
    return `https://${parsed.hostname}/${REDACTED}`;
  }
  if (!parsed.hostname.endsWith(".slack.com")) {
    return REDACTED_URL;
  }
  parsed.hostname = FIXTURE_SLACK_HOST;
  return redactFixtureText({ denylist, home, ids, text: parsed.toString() });
}

/**
 * Provider ids with an uppercase prefix and an all-caps body — Slack channels, users, teams, bots, DMs.
 *
 * A superset of the hygiene gate's own `raw-workspace-id` prefixes (`[CUAWDGTE]`) plus `B` for a bot: the
 * gate is a floor that must not false-positive on English words in prose, while this is a mapper running
 * over a record set that is nearly all ids, so a bot id the gate tolerates is still mapped here.
 */
const PREFIXED_ID = /\b(?=[A-Z0-9]*[0-9])[BCDEGTUAW][A-Z0-9]{8,}\b/g;

/** A canonical UUID — how cmux names a workspace and a surface. Mapped, never kept. */
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/** Secret shapes, copied from the hygiene gate's own class list. A frozen file must carry none of them. */
const SECRETS: readonly RegExp[] = [
  /xox[bp]-[A-Za-z0-9-]{10,}/g,
  /gh[posr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /secret_[A-Za-z0-9]{16,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/g,
];

/** An email address anywhere in a kept string. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * An absolute home path. Matches the hygiene gate's `absolute-home-path` class exactly, so anything the
 * freeze's own refuse-every-hit scan would meet is rewritten here first.
 */
const ABSOLUTE_HOME = /\/(?:Users|home)\/[A-Za-z0-9._-]+/g;

/**
 * The working id map a freeze threads through every file it writes: real id → synthetic id.
 *
 * Mutable on purpose, and never persisted: the map is the ONLY thing that could reverse the redaction, so
 * it lives for the length of one `turn freeze` process and is reported as a count, never as its contents.
 */
export type FixtureIdMap = Map<string, string>;

/**
 * The synthetic id one real id gets, assigned on first sight and stable thereafter.
 *
 * ## Two constraints that look contradictory and are not
 *
 * The synthetic must still PARSE as a provider id — `../../slack/permalink.ts` requires `^[CGD][A-Z0-9]+$`
 * of a conversation id, and a fixture whose channel does not satisfy it is a fixture the stores refuse to
 * read, which is exactly what a replay needs them to do. It must ALSO never trip the hygiene gate's
 * `raw-workspace-id` class, or the freeze's own scan, which refuses every hit, writes no fixture. A first
 * attempt used `C_FIXTURE_01`, which cleared the gate and failed the parser.
 *
 * The gate's own pattern settles it twice over: `\b(?=[A-Z0-9]*[0-9])[CUAWDGTE][A-Z0-9]{8,}\b` requires
 * at least one DIGIT in the run, and its allowance waves through any match carrying `FIXTURE`. An
 * all-letter id satisfies the Slack parser and can never satisfy that lookahead, so the ordinal is spelled
 * in letters rather than numerals. Reproduce with `grep -n 'raw-workspace-id' src/hygiene/scan.ts`.
 *
 * @param real the id as it appears on disk
 * @param ids the working map, extended in place
 * @returns the synthetic id to write instead
 */
export function syntheticIdFor({ real, ids }: { real: string; ids: FixtureIdMap }): string {
  const seen = ids.get(real);
  if (seen !== undefined) {
    return seen;
  }
  const ordinal = letterOrdinal({ index: ids.size });
  // A prefixed provider id keeps its prefix so a reader can still tell a channel from a user; a UUID has no
  // prefix to keep, and gets a name that is obviously not one.
  const minted = /^[BCDEGTUAW][A-Z0-9]{8,}$/.test(real)
    ? `${real[0]!}FIXTURE${ordinal}`
    : `fixture-uuid-${ordinal.toLowerCase()}`;
  ids.set(real, minted);
  return minted;
}

/**
 * A zero-based index as an all-letter, fixed-width ordinal: `AA`, `AB`, … `ZZ`.
 *
 * Letters rather than numerals so a minted id can never carry the digit the hygiene gate's workspace-id
 * class requires; fixed-width so two ids sort the way they were minted.
 *
 * @param index the zero-based ordinal
 * @returns the two-letter form
 */
function letterOrdinal({ index }: { index: number }): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const high = alphabet[Math.floor(index / alphabet.length) % alphabet.length]!;
  const low = alphabet[index % alphabet.length]!;
  return `${high}${low}`;
}

/**
 * Scrub one kept string: map every id in it, neutralise every secret class, and rewrite absolute paths.
 *
 * Order matters and mirrors `../../../corpus/redact.ts`: secrets first, because a token can contain the
 * character classes the later passes carve on. The HOME-PREFIX rewrite then runs before the id passes,
 * because it is a literal split and those passes can rewrite the very prefix it is looking for — see the
 * measurement at the call. The generic absolute-path rewrite still runs last.
 *
 * @param text the kept string, as it appears on disk
 * @param ids the working id map, extended in place
 * @param home the live `$SLOPWEAVER_HOME` this record set was frozen from, rewritten to
 *   {@link HOME_PLACEHOLDER} so the fixture is relocatable
 * @param denylist the private org-word list, applied last so a word revealed by an earlier pass is caught
 * @returns the scrubbed string
 */
export function redactFixtureText({
  text,
  ids,
  home,
  denylist,
}: {
  text: string;
  ids: FixtureIdMap;
  home: string;
  denylist: readonly string[];
}): string {
  let out = text;
  for (const secret of SECRETS) {
    out = out.replace(secret, "[token]");
  }
  out = out.replace(EMAIL, "[email]");
  // The home prefix is rewritten BEFORE the id passes, and that ordering is load-bearing rather than
  // arbitrary. It is a LITERAL split, so it only matches text that still spells the home path — and a home
  // containing a UUID stops spelling it the moment `UUID` has run. MEASURED freezing through
  // `--home <a session scratchpad>`: every `verdictPath` and `packetPath` in the fixture kept its full
  // absolute staging path, because the session id inside it had already become `fixture-uuid-cf`. The
  // operator's own `$SLOPWEAVER_HOME` carries no UUID, which is why this never bit until a freeze was
  // pointed at a staged one. Running it here is safe: `SECRETS` has already been through, and the tail the
  // split preserves goes through every pass below.
  out = out.split(home).join(HOME_PLACEHOLDER);
  out = out.replace(UUID, (match) => syntheticIdFor({ ids, real: match }));
  out = out.replace(PREFIXED_ID, (match) => syntheticIdFor({ ids, real: match }));
  // Anything else absolute loses only the machine's user directory, and this stays LAST so it catches a
  // path an earlier pass revealed.
  out = out.replace(ABSOLUTE_HOME, "/fixture/user");
  for (const word of denylist) {
    out = replaceCaseInsensitive({ replacement: "[redacted-word]", text: out, word });
  }
  return out;
}

/**
 * Replace every case-insensitive occurrence of a literal substring.
 *
 * The word is REGEX-ESCAPED before it is compiled, so a denylist entry is always matched as literal text —
 * a word arriving from a private file must never be able to act as a pattern. Escaping also removes any
 * ReDoS surface: an escaped literal has no alternation, no nesting and no quantifier.
 *
 * A case-insensitive `indexOf` over a lowercased copy was the obvious alternative and is subtly wrong:
 * `toLowerCase` is not length-preserving for every code point, so the offsets it returns can be off by one
 * against the original string.
 *
 * @param text the string to scrub
 * @param word the literal to remove
 * @param replacement what to put in its place
 * @returns the scrubbed string
 */
function replaceCaseInsensitive({
  text,
  word,
  replacement,
}: {
  text: string;
  word: string;
  replacement: string;
}): string {
  if (word.length === 0) {
    return text;
  }
  return text.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);
}

/**
 * Redact one parsed JSON value: a string leaf survives only when its key is allowlisted, arrays inherit
 * their array's key, and non-string leaves are kept as they are.
 *
 * @param value the parsed value
 * @param key the object key this value sits under, or `undefined` at the document root
 * @param ids the working id map, extended in place
 * @param home the live home to rewrite out of every kept path
 * @param denylist the private org-word list
 * @returns the redacted value
 */
export function redactFixtureValue({
  value,
  key,
  ids,
  home,
  denylist,
}: {
  value: unknown;
  key: string | undefined;
  ids: FixtureIdMap;
  home: string;
  denylist: readonly string[];
}): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactFixtureValue({ denylist, home, ids, key, value: entry }));
  }
  if (isRecord(value)) {
    // `SourceCapability.id` (`../../../route/profile.ts`) is schema-constrained to lower-kebab-case, and
    // the blanket "[REDACTED]" a bare `id` key would otherwise get fails that regex outright — a brief
    // carrying capabilities could never be frozen at all. `sourceClass` sits only on this exact shape, so it
    // is the discriminator; `syntheticIdFor` already mints a kebab-case-safe string for a non-provider id, so
    // this reuses it rather than inventing a second minting scheme.
    const isCapabilityShaped = typeof value["sourceClass"] === "string" && typeof value["id"] === "string";
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => {
        if (isCapabilityShaped && childKey === "id" && typeof childValue === "string") {
          return [childKey, syntheticIdFor({ ids, real: childValue })];
        }
        return [childKey, redactFixtureValue({ denylist, home, ids, key: childKey, value: childValue })];
      }),
    );
  }
  if (typeof value !== "string") {
    return value;
  }
  if (key !== undefined && URL_KEYS.has(key)) {
    return redactUrlValue({ denylist, home, ids, value });
  }
  const sanctioned = key === undefined ? undefined : KEEP_WHEN_VALUE_MATCHES.get(key);
  if (sanctioned !== undefined) {
    return sanctioned.test(value) ? value : REDACTED;
  }
  if (key === undefined || !KEEP_KEYS.has(key)) {
    return REDACTED;
  }
  return redactFixtureText({ denylist, home, ids, text: value });
}

/**
 * Redact one JSON document, keeping its formatting stable so a committed fixture diffs readably.
 *
 * @param raw the file's raw text
 * @param ids the working id map, extended in place
 * @param home the live home to rewrite out of every kept path
 * @param denylist the private org-word list
 * @returns the redacted JSON text, or `undefined` when the document will not parse
 */
export function redactJsonDocument({
  raw,
  ids,
  home,
  denylist,
}: {
  raw: string;
  ids: FixtureIdMap;
  home: string;
  denylist: readonly string[];
}): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return `${JSON.stringify(redactFixtureValue({ denylist, home, ids, key: undefined, value: parsed }), null, 2)}\n`;
}

/**
 * Redact a line-delimited record file, keeping it line-delimited.
 *
 * A line that will not parse is kept verbatim rather than dropped, the same way the ask log's own lines are:
 * a malformed line in an append-only file two processes write is an ordinary state, and losing it would make
 * the fixture disagree with the record set it claims to be.
 *
 * @param raw the file's raw text
 * @param ids the working id map, extended in place
 * @param home the live home to rewrite out of every kept path
 * @param denylist the private org-word list
 * @returns the redacted JSONL text
 */
export function redactJsonLines({
  raw,
  ids,
  home,
  denylist,
}: {
  raw: string;
  ids: FixtureIdMap;
  home: string;
  denylist: readonly string[];
}): string {
  const lines = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const redacted = redactJsonDocument({ denylist, home, ids, raw: line });
      return redacted === undefined ? line : JSON.stringify(JSON.parse(redacted));
    });
  return `${lines.join("\n")}\n`;
}
