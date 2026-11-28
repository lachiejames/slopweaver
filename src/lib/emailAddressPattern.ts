/**
 * The one email-address detector every redaction boundary shares: the outbound PII pass
 * (`src/outbound/slack/piiRedaction.ts`), the corpus prose pass (`src/corpus/redact.ts`) and the replay-fixture
 * redactor (`src/live/turn/freeze/redact.ts`). Pure, no imports.
 *
 * An address includes one whose local part is QUOTED (`"first last"@example.com`, `"a@b"@example.com`),
 * because a closing quote is not a word character and a bare `[\w.+-]+@` pattern never starts a match on it,
 * so every boundary takes this one detector rather than spelling its own. The quoted arm never crosses an
 * unescaped quote or a line ending, and is capped at the 62 characters RFC 5321's 64-octet local part leaves
 * between the quotes, so a stray quote pair in prose cannot swallow a sentence. A quoted string with no
 * `@domain.tld` straight after its closing quote, and a bare `@mention`, never match.
 *
 * It is a detector rather than a validator, and two residues are stated rather than discovered: an escape pair
 * counts as ONE character against the cap (so a quoted part of up to 124 code units can match — over-redaction,
 * the safer direction), and a percent-encoded `mailto:` target (`%22...%22@`) is a different representation it
 * does not decode.
 */

/**
 * Build the shared email-address detector, fresh on every call.
 *
 * A factory rather than an exported `RegExp`: the pattern carries the `g` flag its consumers' `replace` /
 * `replaceAll` need, and a `g`-flagged regex keeps `lastIndex` between `.test` / `.exec` calls, so one instance
 * shared across modules would let one consumer's state make another's next match intermittently miss.
 *
 * @returns a new global regular expression matching a bare or quoted-local-part email address
 */
export function emailAddressPattern(): RegExp {
  return /(?:"(?:[^"\\\r\n]|\\.){0,62}"|[\w.+-]+)@[\w-]+(?:\.[\w-]+)+/g;
}
