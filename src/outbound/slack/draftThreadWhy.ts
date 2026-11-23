/**
 * The one free-text heuristic over a parked draft's `--why`: whether its words say the message belongs in a thread.
 * Kept beside the register rather than in it, because the register is the row's SHAPE and this reads its prose.
 */

/**
 * Whether a `--why` says the draft is a thread reply — the words both incident rows carried
 * (`THREAD REPLY, not top-level`) and the two other shapes the register held (`IN-THREAD reply`, a named
 * `thread_ts`), plus `reply in/under … thread`.
 *
 * MEASURED over all 45 rows of `slopweaver slack draft list --all --json`: exactly the four
 * thread rows match and no other. Repro: `slopweaver slack draft list --all --json | jq -r '.items[] |
 * select(.draft.why | test("\\bthread[\\s-]*repl(y|ies)\\b|\\bin[\\s-]thread\\b|\\bthread_ts\\b"; "i")) | .id'`.
 * A heuristic over free text; the structural guarantee is `ParkedSlackDraft.shape` (`./draftRegister.ts`), and this exists
 * for a row recorded before that field could say thread, and for a recorder that forgot `--thread-ts`.
 *
 * @param why the row's one-line purpose
 * @returns true when the words say the message belongs in a thread
 */
export function whySaysThreadReply({ why }: { why: string }): boolean {
  return THREAD_REPLY_WORDS.some((pattern) => pattern.test(why));
}

/** The criterion {@link whySaysThreadReply} applies, one shape per entry. */
const THREAD_REPLY_WORDS: readonly RegExp[] = [
  /\bthread[\s-]*repl(?:y|ies)\b/i,
  /\bin[\s-]thread\b/i,
  /\bthread_ts\b/i,
  /\brepl(?:y|ies|ying)\s+(?:in|into|under|on)\s+(?:\S+\s+){0,3}thread\b/i,
];
