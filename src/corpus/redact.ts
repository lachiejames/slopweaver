/**
 * Generic PII / secret scrubbing, applied to a record's free text before it is written to disk. Pure,
 * deterministic, no I/O. This is defence-in-depth: content ingested from a repo can carry a leaked
 * token or an email in a comment, and the corpus is meant to be shareable, so we neutralise the common
 * classes here rather than trust every upstream author.
 *
 * It deliberately preserves graph-edge tokens — `@mention`, `#<number>`, `TEAM-123` — so cross-referencing
 * still works after redaction. Order matters: secrets run first (a token can contain `@` and digits, so
 * scrubbing it first stops the email/number passes from carving it up).
 */

import { stripControlBytes } from "./sanitise.js";

export type RedactionCategory = "token" | "email" | "number";

interface Pass {
  readonly category: RedactionCategory;
  readonly re: RegExp;
  readonly replacement: string;
  /**
   * Spans this pass must leave alone. Only the number pass declares any — see
   * {@link NUMBER_EXEMPT_SPANS}, {@link UUID_SPAN} and {@link GIT_OID_SPAN}.
   */
  readonly exempt?: RegExp;
}

/**
 * A canonical UUID, in the layout every provider id here takes: 8-4-4-4-12 hex.
 *
 * It exists because the `\d{9,}` pass CARVES ONE UP. A UUID's final group is 12 hex characters, so a group
 * holding nine or more consecutive digits is a long digit run by that pattern's reckoning, and the stored
 * form becomes `01d0a8c3-1c3e-4cc4-956b-[number]efe`. Measured over the real Linear history store
 * (`corpus/history/linear.jsonl`, some 300,000 rows): a few hundred distinct UUIDs — under 0.1% — are stored mangled
 * that way. Small, and lethal where it lands, because the mangled form still PARSES as an id-shaped string:
 * a workflow-state id copied out of the corpus reads as plausible and is not the id it claims to be.
 *
 * Exempting it costs no scrubbing, and that is decidable rather than hopeful. A UUID span holds only hex
 * digits and hyphens, so it cannot contain an `@` (the email pass), an `_` (`secret_`, `github_pat_`), a
 * non-hex letter (`xox`, `gh?_`, `sk-`) or the literal `Bearer`. The `\d{9,}` pass is the ONLY one whose
 * pattern can match inside it — which is why the exemption is declared on that pass alone rather than
 * applied to the text as a whole. `Bearer <uuid>` therefore still redacts: the token pass runs first, on the
 * full text, and by the time the exemption is computed there is no UUID left to protect.
 *
 * The `\b` anchors are load-bearing in the other direction. A genuine long digit run ABUTTING a UUID
 * (`1234567890abcdef12-3456-…`) fails the leading boundary, so no span is exempted there and the digits are
 * scrubbed exactly as before — the exemption can never be reached by prefixing digits to hex.
 *
 * This does not heal bronze already on disk: the mangling happened at ingest, and the rows carry no record of
 * what they held. What it stops is the next one.
 */
const UUID_SPAN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/**
 * A full git object id — 40 lowercase hex characters — carved up by the same `\d{9,}` pass, for the same
 * reason and with a much worse hit rate. A 40-character hex string holds a run of nine consecutive DIGITS
 * far more often than a UUID's 12-character tail does: MEASURED on the first day of the widened GitHub
 * capture, **23 of 88** commit oids written to bronze — 26% — came back as
 * `<hex>[number]<hex>` in place of the 40 hex characters. Reproduce on any window:
 * `slopweaver refresh --source github --repo <r> --since <d> --refetch-unchanged` then
 * `grep -o '"commit":"[^"]*"' <the window file> | grep -c '\[number\]'`.
 *
 * It matters more than the UUID case because a commit oid's whole job is to be CHECKABLE — `git show` it,
 * diff against it, ask which commit a review approved — and a mangled one still reads as a sha while
 * resolving to nothing. The widened selection set promotes four of them (`headRefOid`, `baseRefOid`,
 * `mergeCommit`, a review's and a review comment's `commit`), so capturing them without this exemption
 * would have written a plausible fiction into a quarter of the rows it was added to fill.
 *
 * The same decidability argument the UUID span makes holds here unchanged: a hex span admits no `@`, `_`,
 * non-hex letter or `Bearer`, so `\d{9,}` is the only pass whose pattern could match inside it. The
 * leading `(?![0-9]{40}\b)` is what keeps a genuine 40-DIGIT decimal run scrubbable — a real sha with no
 * letter at all has probability (10/16)^40, about one in a billion, so the guard costs nothing. It is
 * spelled as a negative lookahead over a FIXED-length body rather than as
 * `[0-9a-f]*[a-f][0-9a-f]*`, which expresses the same set and trips `redos-check`: two quantifiers over
 * overlapping classes backtrack polynomially on an all-digit input a comment author controls.
 *
 * **The residue, measured rather than argued.** A 40-character span of `[0-9a-f]` holding ONE letter and
 * 39 digits is exempted whole, so that digit run survives where it used to be scrubbed —
 * `redactText({ text: "a" + "1".repeat(39) })` returns its input. It is the same residue the UUID span
 * already accepts on its 12-hex tail, and it is left rather than closed because the alternative is worse:
 * a criterion tight enough to catch it (demand several letters) starts mangling a real sha that happens to
 * be digit-heavy, trading a leak of essentially zero probability for a SILENT corruption of the exact field
 * this exemption exists to keep true. Nothing reaching here is a secret shape anyway — the token and email
 * passes have already run on the full text, and a hex span cannot hold what they look for.
 */
const GIT_OID_SPAN = /\b(?![0-9]{40}\b)[0-9a-f]{40}\b/g;

/**
 * A SHA-256 digest — 64 lowercase hex characters — the third member of the same family, and the one with
 * the worst hit rate of the three because it is the longest span.
 *
 * This is not a hypothetical extension of the argument above. MEASURED on a live
 * `slopweaver refresh --source notion --fetch-cap 80` into a throwaway home: **6 of the 82** bronze rows
 * naming a stored page body — 7.3% — carried a digest the `\d{9,}` pass had carved up, so the sidecar they
 * named could not be opened at all. One stored form, verbatim:
 * `sha256:<hex>[number]<hex>[number]<hex>`. Reproduce on any corpus that has
 * stored one: `grep -ho '"body":"sha256:[^"]*"' <bronze>/notion/*.jsonl | grep -c '\[number\]'`.
 *
 * **It is not only the body sidecar.** A fetched attachment is named on a record the same way — a
 * `files` entry reading `attachment: sha256:<digest>` (`corpus/notion/attachmentStore.ts`) — so the same
 * share of attachment references have been unopenable since that store landed, silently, because a mangled
 * digest still reads as a digest. Both stores are content-addressed, which is exactly what makes this
 * lethal rather than lossy: the digest is not a label on the content, it IS the address, so carving one
 * character out of it does not degrade a pointer, it destroys it.
 *
 * The decidability argument is unchanged from the two spans above, because it turns on the CHARACTER SET
 * rather than the length: a hex span admits no `@` (the email pass), no `_` (`secret_`, `github_pat_`), no
 * non-hex letter (`xox`, `gh?_`, `sk-`) and no `Bearer`, so `\d{9,}` remains the only pass whose pattern
 * can match inside one. The `(?![0-9]{64}\b)` guard keeps a genuine 64-DIGIT decimal run scrubbable, at the
 * same negligible cost: a real digest with no letter at all has probability (10/16)^64, about one in
 * 10^13. It is spelled as a negative lookahead over a fixed-length body for the same `redos-check` reason.
 */
const SHA256_SPAN = /\b(?![0-9]{64}\b)[0-9a-f]{64}\b/g;

/**
 * A Slack message timestamp — ten epoch seconds, a dot, six more digits — the fourth member of this
 * family and the one with by far the worst hit rate of the four.
 *
 * MEASURED on the live store (over a million rows, most of them Slack): the `\d{9,}` pass had
 * carved up **over nine in ten `content_slack.message_ts` values, and every non-null `thread_ts`** —
 * against under 0.1% for the UUID span, about a quarter for a git oid and under a tenth for a digest.
 * `store/project.ts` promotes both columns out of the scrubbed `raw`/`attrs` bags, so every one of them
 * reads `[number].857509` and carries only the microsecond tail. Reproduce on any loaded store:
 *
 * ```sql
 * select count(*) filter (where position('[' in message_ts) > 0),
 *        count(*) filter (where message_ts ~ '^[0-9]+[.][0-9]+$'), count(*) from content_slack;
 * ```
 *
 * It matters for the same reason the digest does: a Slack `ts` is not a label on a message, it IS the
 * address — of the message, of its thread, and of its permalink. Carved up, it still reads as a
 * timestamp, so a thread grouped on it groups by six digits: **thousands of thread keys in that store
 * merge two or more genuinely different threads, the worst merging eight, over tens of thousands of rows.**
 * `store around --mode thread` printed those as ONE conversation with nothing marking it, which is the
 * `skills/slack/reference/timestamps.md` failure class with the timestamp not shifted but gone.
 *
 * The decidability argument the three spans above make holds here unchanged, and it turns on the
 * character set rather than the length: this span admits only digits and a single dot, so it can hold no
 * `@` (the email pass), no `_` (`secret_`, `github_pat_`), no letter at all (`xox`, `gh?_`, `sk-`, and
 * `Bearer`) — `\d{9,}` is the only pass whose pattern can match inside one.
 *
 * The `1[5-9]` prefix is what keeps this narrow rather than exempting every `\d{10}\.\d{6}`: it admits
 * epoch seconds from 2017-07 to 2033-05 and nothing else, so a sixteen-digit run that happens to carry a
 * decimal point elsewhere in a body is still scrubbed exactly as before.
 *
 * This does not heal the rows already stored — the mangling happened at ingest and bronze keeps no record
 * of what it held. What DOES heal them is that `corpus/slack/project.ts` puts the same two timestamps in
 * the record's `sourceId`, which {@link ./redactRecord.redactRecord} never passes through any pass, so
 * `store/project.ts` can derive both columns from the id and a re-ingest of the bronze already on disk is
 * enough. This span is what stops the next one being written wrong in the first place.
 */
const SLACK_TS_SPAN = /\b1[5-9][0-9]{8}\.[0-9]{6}\b/g;

/**
 * Every span the `\d{9,}` pass must leave alone. One regex rather than a list because {@link applyPass}
 * walks the exempt matches in order and slices between them — an alternation is what keeps that walk
 * single-pass and the spans non-overlapping.
 */
const NUMBER_EXEMPT_SPANS = new RegExp(
  // Longest first. `applyPass` walks these matches in order and slices between them, so an alternation
  // that could match a PREFIX of a longer span would exempt only that prefix and leave the tail to be
  // carved — and a 64-hex digest opens with a 40-hex span that `GIT_OID_SPAN`'s own `\b` would not end on,
  // but the alternation's first-match-wins order is what makes that impossible to rely on by accident.
  // The Slack span is last because it is the only one whose body is not hex: it can neither be a prefix
  // of nor overlap any of the three above, so its position here is a convention rather than a dependency.
  `${SHA256_SPAN.source}|${GIT_OID_SPAN.source}|${UUID_SPAN.source}|${SLACK_TS_SPAN.source}`,
  "g",
);

/**
 * Ordered passes. Secret shapes first, then emails, then long digit runs.
 *
 * NONE of the token shapes is `\b`-anchored, and that is deliberate. `\b` requires a word/non-word
 * transition immediately before the match, so a single preceding word character — a letter, a digit or an
 * underscore — makes the pattern miss and writes the secret verbatim. Three shapes carried that anchor and
 * three did not, and the hole it opens has two ordinary routes in:
 *
 * - A secret embedded after a word character, e.g. `<name>_client_secret=<prefix>_secret_<24 chars>`. The
 *   `_` before `secret_` kills the boundary, so an anchored pass leaves the whole value standing. A
 *   `client_secret_`-style spelling is the common real-world form of the shape the pattern exists to catch,
 *   and the anchor excludes exactly it.
 * - Flattening a Slack `rich_text` tree joins adjacent leaves with no separator, so a leaf ending `"x"`
 *   followed by a leaf holding an `sk-` key concatenates into `xsk-…` and evades the anchored pattern —
 *   while the same key, redacted as its own leaf, is scrubbed.
 *
 * The anchors presumably existed to hold down false positives, and the trade is one-sided: an unanchored
 * pass can newly match a URL slug whose `…-task-<hex>` tail reads as `sk-` + a body, which costs that slug
 * its fidelity, while an anchored one writes a credential to disk. Such a slug has usually ALREADY lost
 * fidelity to the `\d{9,}` pass, which leaves a literal `[number]` inside it, so closing the hole costs
 * little that was not lost before it. Reproduce the class on any corpus: `slopweaver audit hygiene --json`.
 */
const PASSES: readonly Pass[] = [
  { category: "token", re: /xox[bp]-[A-Za-z0-9-]{10,}/g, replacement: "[token]" },
  { category: "token", re: /gh[posr]_[A-Za-z0-9]{20,}/g, replacement: "[token]" },
  { category: "token", re: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: "[token]" },
  { category: "token", re: /secret_[A-Za-z0-9]{16,}/g, replacement: "[token]" },
  // The `sk-proj-`/`sk-svcacct-`/`sk-admin-` family, which the LOOSER-looking arm below cannot reach: a
  // project key's body is base64url, so it carries `-` and `_`, and `[A-Za-z0-9]` stops at the first
  // hyphen — `sk-proj` is seven characters, under any floor, so the pattern never fires at all. The stated
  // asymmetry in `../hygiene/scan.ts` ("redact.ts deliberately keeps the LOOSE spellings … over-scrubbing
  // costs a URL slug's fidelity, under-scrubbing writes a secret to disk") was therefore FALSE for this
  // one family, in the expensive direction: any quoted text carrying a project-scoped key — a diff, a
  // pasted config line — passes the scrubber untouched, and only the corpus-hygiene gate, reading the
  // stored row afterwards as `openai-style-key`, can see it. Reproduce the class on any corpus:
  // `slopweaver audit hygiene --json`.
  //
  // Deliberately looser than the gate's spelling of the same family, which additionally demands 48
  // characters and an uppercase letter. Those exist to keep a GATE actionable, where a false positive is
  // the expensive one; here a false positive costs one URL slug its fidelity. That is the trade this file
  // is on the other side of.
  { category: "token", re: /sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g, replacement: "[token]" },
  { category: "token", re: /sk-[A-Za-z0-9]{20,}/g, replacement: "[token]" },
  { category: "token", re: /Bearer\s+[A-Za-z0-9._-]{12,}/g, replacement: "[token]" },
  { category: "email", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, replacement: "[email]" },
  { category: "number", exempt: NUMBER_EXEMPT_SPANS, re: /\d{9,}/g, replacement: "[number]" },
];

/**
 * Redact a string, returning the scrubbed text and which categories fired (deduped, in pass order).
 *
 * @param text the raw text to scrub
 * @returns the scrubbed text and the categories that matched
 */
export function redactText({ text }: { text: string }): { text: string; redactions: readonly RedactionCategory[] } {
  // Structural sanitisation runs FIRST, and it is not a privacy pass. A raw control byte inside a record is a
  // line terminator to some reader of line-delimited bronze, and an ANSI escape reaching a terminal can
  // rewrite output that was already printed — so text arriving from an issue comment can overwrite what sits
  // above it. Measured over the real corpus: a few hundred records in several hundred thousand carry one,
  // nearly all of them GitHub, and the
  // commonest is U+001B from pasted terminal output. Doing it here rather than per-connector means every
  // source gets it from the one choke-point every record already passes through.
  return applyPasses({ passes: PASSES, text: stripControlBytes({ text }).text });
}

/**
 * Scrub only the SECRET classes (tokens + long digit runs), deliberately PRESERVING emails. Member bronze
 * captures each person's email as the cross-source join key (D8) and lives off-repo under `$SLOPWEAVER_HOME`,
 * so the email-scrubbing {@link redactText} would destroy the very field member hydration exists to keep —
 * while tokens/secrets must still never touch disk.
 *
 * @param text the raw text to scrub
 * @returns the scrubbed text (emails intact) and the categories that matched
 */
export function redactSecrets({ text }: { text: string }): { text: string; redactions: readonly RedactionCategory[] } {
  return applyPasses({ passes: PASSES.filter((pass) => pass.category !== "email"), text });
}

/**
 * The author-only address pass, run after the shared email pass. That pass's pattern is tuned for prose, so it
 * misses valid address forms a provider can still hand back: a quoted local part (`"boss"@example.test`), an
 * address-literal domain (`boss@[192.0.2.1]`), a single-label domain. An author is a name, never prose, so here
 * any whitespace-free run with something on both sides of an `@`, or a quoted string before one, is an
 * address. A name such as `Team @ Acme` has whitespace around its `@` and survives, and a native-id author
 * never reaches this pass.
 *
 * What it does NOT close: an RFC 5322 address written with folding whitespace or a comment beside its `@`
 * (`boss @ example.test`) survives, because that is indistinguishable from the name above. No provider read
 * here hands one back, and this pass is the backstop rather than the mechanism — every diary, mail and
 * recorded-call projection sets `author` through `personName` (`./personName.ts`), which never returns an `@`.
 */
const AUTHOR_ADDRESS_PASS: Pass = {
  category: "email",
  re: /(?:"[^"]*"|[^\s"<>@]+)@(?:\[[^\]\s]*\]|[^\s"<>@]+)/g,
  replacement: "[email]",
};

/**
 * Scrub a record's `author`: the token and email classes plus {@link AUTHOR_ADDRESS_PASS}, deliberately
 * SKIPPING the long-digit pass.
 *
 * `author` is a key under most sources — a Slack user id, a GitHub login or node id, a Linear UUID — and the
 * derived identity roster mints people from it by its native-id SHAPE (`src/silver/nativeIdShape.ts`), so
 * the `\d{9,}` pass would carve up exactly the field that has to stay checkable. A GitHub login CAN match
 * the token pass (`sk-` and twenty alphanumerics is a legal login), so `redactRecord` exempts a value that is
 * its source's native-id shape before calling this. What is left is what this is for: an address that
 * reaches `author` — the diary's organiser, a recorded call's host — is written as `[email]`, never itself.
 *
 * @param text the author value as the projection set it
 * @returns the scrubbed author and the categories that matched
 */
export function redactAuthor({ text }: { text: string }): { text: string; redactions: readonly RedactionCategory[] } {
  return applyPasses({
    passes: [...PASSES.filter((pass) => pass.category !== "number"), AUTHOR_ADDRESS_PASS],
    text,
  });
}

/**
 * Scrub ONLY the token classes, leaving emails, long digit runs and every other byte exactly as they are.
 *
 * The narrowest pass in this file, and the narrowness is the point: it is what a REPAIR applies to a bronze
 * line that is already on disk. A token shape cannot occur in JSON structural syntax — none of the patterns
 * admits a `"`, a `\` or a brace — so replacing one inside a raw JSONL line rewrites the secret and nothing
 * else, with no parse, no re-serialisation and no chance of dropping a field the reader did not model.
 * {@link redactText} would be wrong here for exactly that reason: its `\d{9,}` pass would carve up a
 * timestamp in the envelope that no ingest ever passed through it.
 *
 * @param text the raw text to scrub
 * @returns the scrubbed text and whether the token pass fired
 */
export function redactTokens({ text }: { text: string }): { text: string; redactions: readonly RedactionCategory[] } {
  return applyPasses({ passes: PASSES.filter((pass) => pass.category === "token"), text });
}

/**
 * One pass over the text, skipping the spans it declares exempt.
 *
 * The exempt spans are recomputed from the text AS IT STANDS when this pass runs, not from the original —
 * so an earlier pass that replaced a span (`Bearer <uuid>` → `[token]`) removes it from consideration here
 * rather than leaving a stale offset behind.
 */
function applyPass({ pass, text }: { pass: Pass; text: string }): string {
  const { re, replacement, exempt } = pass;
  // `String.replace` with a global regex is stateless (resets lastIndex), so no `.test()` footgun.
  if (exempt === undefined) {
    return text.replace(re, replacement);
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(exempt)) {
    parts.push(text.slice(cursor, match.index).replace(re, replacement), match[0]);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor).replace(re, replacement));
  return parts.join("");
}

/** Apply an ordered pass list to text, tracking which categories fired (deduped, in pass order). Pure. */
function applyPasses({ passes, text }: { passes: readonly Pass[]; text: string }): {
  text: string;
  redactions: readonly RedactionCategory[];
} {
  let out = text;
  const fired: RedactionCategory[] = [];
  for (const pass of passes) {
    const next = applyPass({ pass, text: out });
    if (next !== out && !fired.includes(pass.category)) {
      fired.push(pass.category);
    }
    out = next;
  }
  return { redactions: fired, text: out };
}
