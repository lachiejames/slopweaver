/**
 * The PII pass every outbound Slack message crosses on its way out. Pure: no I/O, deterministic.
 *
 * ## Why this exists here, and only here
 *
 * RUM and user identity in live hits are seen whole by the investigating session, which redacts PII before posting
 * into Slack: redacting mid-investigation is a hindrance, and correlating via IP is a useful move during Datadog
 * investigations (when a user id is not in the log, check which logs or other telemetry came from an IP address and
 * whether any carried a uid, which can reveal the uid), so the session needs to be able to do this too.
 *
 * That is a pair of decisions, not one: **nothing masks in the read path**
 * ({@link ../../datadog/detective/record} is the whole event, `usr.*` and `session.ip` included), and the
 * redaction lands **at the post**, which is the one place an audience appears. This module is the second
 * half, and its being a mechanism rather than an instruction is the point — a composing session that is
 * told to redact will redact almost always, and "almost always" is not a property.
 *
 * Two CLI prints are a printed line rather than a post, and call it for the same reason: `session list` over a
 * session's free-text note and `cmux usage` over a session's title, plain and `--json` alike, each over that one
 * field only (`cli/commands/session/run.ts`, `cli/commands/cmux/usageOutput.ts`). A session types the note, so it
 * can carry an address; the ledger keeps it as written.
 *
 * ## The class is NARROW on purpose, and the line is stated rather than implied
 *
 * Redacted: **email addresses** and **IP addresses**. Both are unambiguously a person's identity or
 * location, and neither is ever the load-bearing content of an answer this bot composes — a message that
 * needs to say "the error came from an IP" says that without the octets.
 *
 * **Not redacted: a UUID**, including one that is a user id. Three reasons, and the third is the one that
 * decides it. UUIDs are not identifying on their own outside the systems that mint them; they are routinely
 * the ANSWER to a question ("which customer record did that job touch") and redacting one would make the
 * message useless; and the owner names the IP-to-uid correlation as a move the owner wants performed, so a pass
 * that swallowed every uid would hide the result of exactly the investigation asked for. A message that
 * should not carry a uid is a judgement about that message, which is what the detective brief's own
 * instruction covers.
 *
 * **Not redacted: a person's NAME.** A message to the installation's own Slack is its own surface, which
 * `AGENTS.md`'s "no organisation names in what you commit" does not govern — that rule is the repository's —
 * and a pass that tried to find names in prose would either miss most of them or redact half the vocabulary.
 *
 * Secrets are a different class with a different owner: `src/hygiene/scan.ts` is the gate for those, and
 * `src/corpus/redact.ts` scrubs them on the way INTO the corpus. This pass is not a second copy of either —
 * it runs at the one boundary neither of them watches.
 */

import { countOf } from "#lib/collections.js";

/** What one redaction replaced, so a caller can report what it changed rather than change it silently. */
export interface Redaction {
  readonly kind: "email" | "ipv4" | "ipv6";
  /** How many spans of this kind were replaced. */
  readonly count: number;
}

/** One pass over the text. */
interface Pass {
  readonly kind: Redaction["kind"];
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * The passes, in order.
 *
 * IPv6 runs before IPv4 because an IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) contains a complete IPv4
 * address: with IPv4 first, the tail is replaced and the surviving `::ffff:[ip]` no longer matches the IPv6
 * pattern, so the message ships a half-redacted address that still reads as one. This is the same ordering
 * rule `src/corpus/redact.ts` states for its own token/email/number passes, met on different shapes.
 *
 * The IPv4 pattern is deliberately strict about octets rather than `\d{1,3}`: an unbounded three-digit run
 * matches a version string (`1.2.300.4`) and a measurement written with dots, and redacting those would make
 * the pass something a composer works around rather than trusts.
 */
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const DOTTED = `(?:${OCTET}\\.){3}${OCTET}`;
const GROUP = "[0-9a-fA-F]{1,4}";

/**
 * Every legal spelling of an IPv6 address, IPv4-mapped form FIRST.
 *
 * First because a JavaScript alternation is ordered rather than longest-match: with the plain forms ahead of
 * it, `::ffff:203.0.113.7` matches the bare `::` alternative, the dotted tail survives, and the IPv4 pass
 * then replaces it — so the message ships `::ffff:[ip]`, which still reads as an address and still carries
 * the whole of it. That is the exact half-redaction this ordering exists to prevent, and it is a defect a
 * casual read of the pattern list does not show.
 *
 * A `\b` cannot anchor this: `::` opens with a non-word character, so a word boundary fails before it. The
 * lookarounds exclude a neighbouring word, colon or dot instead, which is what keeps an ISO timestamp
 * (`20:09:04`) and a version string out — neither carries `::` nor the eight groups the uncompressed form
 * needs.
 */
const IPV6 = new RegExp(
  [
    `::(?:ffff(?::0{1,4})?:)?${DOTTED}`,
    `(?:${GROUP}:){6}${DOTTED}`,
    `(?:${GROUP}:){7}${GROUP}`,
    `(?:${GROUP}:){1,7}:`,
    `(?:${GROUP}:){1,6}:${GROUP}`,
    `(?:${GROUP}:){1,5}(?::${GROUP}){1,2}`,
    `(?:${GROUP}:){1,4}(?::${GROUP}){1,3}`,
    `(?:${GROUP}:){1,3}(?::${GROUP}){1,4}`,
    `(?:${GROUP}:){1,2}(?::${GROUP}){1,5}`,
    `${GROUP}:(?::${GROUP}){1,6}`,
    `:(?::${GROUP}){1,7}`,
    "::",
  ]
    .map((alternative) => `(?:${alternative})`)
    .join("|"),
  "g",
);

const PASSES: readonly Pass[] = [
  {
    kind: "ipv6",
    pattern: new RegExp(`(?<![\\w:.])(?:${IPV6.source})(?![\\w:.])`, "g"),
    replacement: "[ip]",
  },
  {
    kind: "email",
    pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    replacement: "[email]",
  },
  {
    kind: "ipv4",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
    replacement: "[ip]",
  },
];

/** One string, redacted, and what was replaced in it. */
export interface RedactedText {
  readonly text: string;
  readonly redactions: readonly Redaction[];
}

/**
 * Redact one string.
 *
 * @param text the string as the composer wrote it
 * @returns the redacted string and what was replaced
 */
export function redactPii({ text }: { text: string }): RedactedText {
  let out = text;
  const redactions: Redaction[] = [];
  for (const pass of PASSES) {
    let count = 0;
    out = out.replaceAll(pass.pattern, () => {
      count += 1;
      return pass.replacement;
    });
    if (count > 0) {
      redactions.push({ count, kind: pass.kind });
    }
  }
  return { redactions, text: out };
}

/**
 * Whether a string carries anything this pass would redact.
 *
 * Separate from {@link redactPii} so a caller that only needs to WARN does not build a second copy of the
 * string it is about to send unchanged.
 *
 * @param text the string to check
 * @returns true when the pass would change it
 */
export function carriesPii({ text }: { text: string }): boolean {
  return PASSES.some((pass) => {
    // A fresh regex per test: the declared patterns carry the `g` flag, and a `g`-flagged regex keeps
    // `lastIndex` between calls — so testing the same pattern twice in one process alternates between
    // matching and not. The bug this avoids is the worst shape available here: an intermittent leak.
    return new RegExp(pass.pattern.source).test(text);
  });
}

/**
 * Redact every string inside an already-rendered Slack payload, leaving its structure untouched.
 *
 * The walk is over the RENDERED payload rather than over the typed form, and that is deliberate: the forms
 * are several and growing, while the payload is the one thing every send path produces. A pass wired into
 * each form would be a pass one new form could be written without.
 *
 * Object KEYS are never redacted, only values — a key is a field name this repository chose, and an email
 * address cannot be one.
 *
 * @param value any part of a rendered payload
 * @returns the same structure with every string redacted, and everything that was replaced
 */
export function redactPayload({ value }: { value: unknown }): { value: unknown; redactions: readonly Redaction[] } {
  const totals = new Map<Redaction["kind"], number>();
  const walk = ({ node }: { node: unknown }): unknown => {
    if (typeof node === "string") {
      const done = redactPii({ text: node });
      for (const redaction of done.redactions) {
        totals.set(redaction.kind, countOf({ counts: totals, key: redaction.kind }) + redaction.count);
      }
      return done.text;
    }
    if (Array.isArray(node)) {
      return node.map((element) => walk({ node: element }));
    }
    if (typeof node === "object" && node !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        out[key] = walk({ node: child });
      }
      return out;
    }
    return node;
  };
  const redacted = walk({ node: value });
  return {
    redactions: [...totals.entries()]
      .map(([kind, count]) => ({ count, kind }))
      .toSorted((left, right) => left.kind.localeCompare(right.kind)),
    value: redacted,
  };
}

/**
 * The one line a send path prints when the pass changed something.
 *
 * Printed rather than silent, because a redaction a composer cannot see is a redaction it cannot learn from
 * — and because a message that came back `[email]` where a name was expected should be traceable to this
 * pass rather than investigated as a rendering bug.
 *
 * @param redactions what the pass replaced
 * @returns the line, or nothing when it replaced nothing
 */
export function redactionLine({ redactions }: { redactions: readonly Redaction[] }): string | null {
  if (redactions.length === 0) {
    return null;
  }
  const parts = redactions.map((redaction) => `${String(redaction.count)} ${redaction.kind}`);
  return `PII pass redacted ${parts.join(", ")} before sending — the read path is deliberately unmasked, the post is not`;
}

/**
 * Redact every string inside one already-built card WRAPPER.
 *
 * The wrapper rather than the payload, because the wrapper is what several renderers actually share. MEASURED
 * by review before this landed: wiring the pass into `renderUpdateCard` alone covered the operator card and
 * MISSED the bot's own answer messages (`../assistant/answerMessage.ts` builds its payload from
 * `renderChromeBlocks` and its own `answerWrapper`, never through `renderUpdateCard`) and the turn message
 * (`../assistant/turnMessage.ts`, through `renderFullChromeWrapper`) — which is to say it missed the surface a
 * Datadog investigation's answer actually goes out on, the one the owner's ruling is about.
 *
 * The no-fold message (`./noFold.ts`) crosses it too, and a canvas body and title cross {@link redactPii} at
 * `../../corpus/slack/writeApiCanvas.ts`'s `canvasDocumentContent` and `canvasWireTitle`.
 *
 * **This is still not every outbound payload.** The drip, progress and stream payloads, and whatever a poll
 * sets outside its wrapper, build their own shapes and do not cross it; they carry rendered state rather than investigation prose, and bringing them in is a
 * follow-up rather than a claim this function makes. A reader should not infer from "the pass exists" that
 * everything crosses it.
 *
 * @param wrapper the built wrapper
 * @returns the same wrapper with its strings redacted
 */
export function redactWrapper<T>({ wrapper }: { wrapper: T }): T {
  // The walk preserves every key and every non-string value, so a one-element tuple and a literal-typed field
  // survive it unchanged — but `unknown` in cannot prove that to the compiler, and a redactor generic enough
  // to preserve the type would be a type-level rewrite of a twelve-line walk. The unit tests assert the
  // structural literals survive (`text` stays `""`, `attachments` stays one element) rather than trusting it.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return redactPayload({ value: wrapper }).value as T;
}
