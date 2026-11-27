/**
 * The anchor an owner turn in a Codex chair's rollout is addressed by: `codex-rollout:<thread>#<rollout>@<offset>`,
 * the thread id, the rollout file's basename, and the byte offset its `user_message` line starts at.
 *
 * A byte offset rather than a line number or a text hash, because a Codex `user_message` carries no id of its own
 * and a resumed thread APPENDS to its rollout, so every earlier offset in the file stays where it was. The prefix
 * cannot be read as a Claude `transcript:` pointer, so no Codex turn can be credited by a Claude anchor or the
 * reverse.
 *
 * Pure: text in, a pointer out. Strict both ways — the thread is a bare id, the basename a rollout file's and
 * nothing that can climb out of the sessions tree, the offset a plain decimal — so a pointer a reader joins into
 * a path or compares as a key has exactly one spelling.
 */
import { isBareSessionId } from "../sessions/liveSessionStore.js";

/** What every Codex rollout owner-turn pointer opens with. */
const CODEX_ROLLOUT_POINTER_SCHEME = "codex-rollout:";

/** A rollout file's basename: `rollout-<stamp>-<thread>.jsonl`, letters, digits and dashes between. */
const ROLLOUT_BASENAME = /^rollout-[A-Za-z0-9-]+\.jsonl$/;

/** A byte offset with one spelling: zero, or digits with no leading zero. */
const BYTE_OFFSET = /^(0|[1-9][0-9]*)$/;

/** One owner turn's address in a Codex rollout. */
export interface CodexRolloutPointer {
  readonly threadId: string;
  /** The rollout file's basename, never a path. */
  readonly rolloutName: string;
  /** Where the turn's line starts in that file, in bytes. */
  readonly byteOffset: number;
}

/**
 * Whether a name is a rollout file's basename, with no separator or traversal in it.
 *
 * @param name the candidate basename
 * @returns true for `rollout-<letters, digits, dashes>.jsonl`
 */
export function isRolloutBasename({ name }: { name: string }): boolean {
  return ROLLOUT_BASENAME.test(name);
}

/**
 * Spell a pointer.
 *
 * @param pointer the turn's address
 * @returns `codex-rollout:<thread>#<rollout>@<offset>`
 */
export function formatCodexRolloutPointer({ pointer }: { pointer: CodexRolloutPointer }): string {
  return `${CODEX_ROLLOUT_POINTER_SCHEME}${pointer.threadId}#${pointer.rolloutName}@${String(pointer.byteOffset)}`;
}

/**
 * Read a pointer, refusing every spelling but the one {@link formatCodexRolloutPointer} writes.
 *
 * @param text the candidate pointer
 * @returns the address, or `undefined` when the text is not exactly one
 */
export function parseCodexRolloutPointer({ text }: { text: string }): CodexRolloutPointer | undefined {
  if (!text.startsWith(CODEX_ROLLOUT_POINTER_SCHEME)) {
    return undefined;
  }
  const body = text.slice(CODEX_ROLLOUT_POINTER_SCHEME.length);
  const hash = body.indexOf("#");
  const at = body.lastIndexOf("@");
  if (hash === -1 || at < hash) {
    return undefined;
  }
  const threadId = body.slice(0, hash);
  const rolloutName = body.slice(hash + 1, at);
  const offset = body.slice(at + 1);
  if (
    !isBareSessionId({ sessionId: threadId }) ||
    !isRolloutBasename({ name: rolloutName }) ||
    !BYTE_OFFSET.test(offset)
  ) {
    return undefined;
  }
  const byteOffset = Number(offset);
  if (!Number.isSafeInteger(byteOffset)) {
    return undefined;
  }
  return { byteOffset, rolloutName, threadId };
}
