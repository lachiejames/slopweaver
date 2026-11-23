/**
 * One test for "did a human-facing reason say anything", used by the pairing floor's waiver
 * (`./landingGate.ts`). A leaf, so any other caller can share it without importing the floor.
 */

/**
 * Whether a stated reason actually says anything a reader could act on.
 *
 * **States what a reason must CONTAIN — a letter or a digit — rather than which characters to exclude.**
 * Four Codex reviews forged four different blank-rendering strings against four successive exclusion lists:
 * `trim()` left U+200B ZERO WIDTH SPACE; excluding `Cf`/`Cc` left U+034F COMBINING GRAPHEME JOINER, a Mark;
 * excluding Marks left U+115F HANGUL CHOSEONG FILLER, a Letter; deferring to Unicode's own
 * `Default_Ignorable_Code_Point` left U+2800 BRAILLE PATTERN BLANK, a Symbol that is not ignorable at all.
 *
 * Four misses in a row is not four bugs, it is the wrong shape of test. An exclusion list can always be
 * out-enumerated, because "renders as blank" is a font property no codepoint class decides. An INCLUSION rule
 * cannot: a reason is prose a human will read, prose has letters or digits, and no arrangement of invisible
 * characters produces one. The `Default_Ignorable` clause survives because U+115F and U+3164 are Letters that
 * render as nothing, which is the one place the two rules disagree.
 *
 * It matters because the waiver is the one thing that makes a bypassed pairing floor countable afterwards.
 * A reason nobody can read is the same as no reason at all.
 *
 * @param reason the caller's stated reason, or `undefined` when they gave none
 * @returns true when at least one character is a letter or digit that is not default-ignorable
 */
export function statesAReason({ reason }: { reason: string | undefined }): boolean {
  // Set subtraction under the `v` flag, which says the rule in one expression: a letter or a digit, MINUS the
  // ones that render as nothing. The two classes genuinely overlap — U+115F is a Letter and default-ignorable
  // — so neither a union nor a lookahead states it as plainly.
  return reason !== undefined && /[[\p{L}\p{N}]--\p{Default_Ignorable_Code_Point}]/v.test(reason);
}
