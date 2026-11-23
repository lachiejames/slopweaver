/**
 * The reads a relay may name that are NOT one of the voice's tools, with no imports at all.
 *
 * Split from `relayDraft.ts` so the console's own tests can read the list: `site/` builds without this
 * repository's dependencies, and the page names these same reads in its relay gate (`site/lib/relayGate.ts`).
 * The tool reads need no such pin — the page refuses a mint whose tool list differs from its own
 * (`refuseOnToolDrift`). These two had no pin, and every relay made while a context
 * pack rode in was refused on `--read-after context_pack`, so the owner's spoken steer never reached the board.
 */

/**
 * The context pack a minted session carries from its start, the delegate's own web search, its code-mode `exec`
 * and its `collaboration.*` sub-agents — text the page did not write that reaches the model with no tool call to
 * record it.
 */
export const RELAY_STANDING_READS: readonly string[] = ["context_pack", "web_search", "code_mode", "collaboration"];

/**
 * The page's reads that ride one turn rather than the whole session: the draft of the card the owner's words began over,
 * steered into the turn they start so a read-back costs no tool call.
 */
export const RELAY_TRANSIENT_READS: readonly string[] = ["open_card_draft"];

/** Each non-tool read in the plain words a reader takes for what it is, never for something the voice said. */
const STANDING_READ_WORDS: Readonly<Record<string, string>> = {
  code_mode: "code execution",
  collaboration: "sub-agents",
  context_pack: "the context pack",
  open_card_draft: "the open card's draft",
  web_search: "web search",
};

/**
 * The delegate's built-ins: a REACH the thread always has, never a read anything recorded happening. Saying them as
 * text the voice held is a claim no record backs.
 */
const UNSEEN_REACH: ReadonlySet<string> = new Set(["web_search", "code_mode", "collaboration"]);

/**
 * Why a relay's reading was dropped, as words: what the thinking model had in front of it that the owner did not say, then
 * what it can reach with no tool call the page sees — never a read's id, and never a reach said as a read.
 *
 * A measured call: every relay line read "the voice read context_pack, web_search, code_mode, collaboration after
 * the owner spoke", and the supervisor took it as the voice reciting a tool inventory aloud — no voice segment of that
 * call, or any other, says one of them (repro: `jq -r 'select(.kind=="segment" and .who=="voice") | .text'
 * $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`). The ids also reach the voice itself: `read_supervisor` hands it the
 * chair's chat, relay lines included (`./supervisorWindow.ts`). In another call, "it held text the owner did not say
 * (the context pack, web search, code execution, sub-agents, the open card's draft)" was read by the chair as the
 * relay CARRYING those texts, and as a web search and code run that never happened. Repro: `grep -c 'held text the
 * owner did not say' $SLOPWEAVER_HOME/handovers/<slug>.md`.
 *
 * @param readsAfter the read ids the relay recorded, first seen first
 * @returns the plain cause, with no identifier in it
 */
export function droppedReadingWhy({ readsAfter }: { readsAfter: readonly string[] }): string {
  const held = readsAfter.filter((read) => !UNSEEN_REACH.has(read)).map((read) => sourceWords({ read }));
  const reach = readsAfter.filter((read) => UNSEEN_REACH.has(read)).map((read) => sourceWords({ read }));
  const parts: string[] = [];
  if (held.length > 0) {
    parts.push(`it had text the owner did not say in front of it: ${listWords({ words: held })}`);
  }
  if (reach.length > 0) {
    parts.push(`its ${listWords({ words: reach })} can reach it with no tool call the console sees`);
  }
  return parts.join("; ");
}

/**
 * Words as a spoken list: "a", "a and b", "a, b and c".
 *
 * @returns the list
 */
function listWords({ words }: { words: readonly string[] }): string {
  if (words.length < 2) {
    return words.join("");
  }
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)!}`;
}

/**
 * One read as words: a standing read's own words, else a tool's name with its underscores as spaces.
 *
 * @param read one read id
 * @returns the words
 */
function sourceWords({ read }: { read: string }): string {
  const standing = STANDING_READ_WORDS[read];
  if (standing !== undefined) {
    return standing;
  }
  return read.replaceAll("_", " ");
}
