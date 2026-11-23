/*
 * What the raw-command gate test files share: the two readers of `classifyRawCommand`'s default-deny verdict, one
 * answering whether a command is blocked and one returning the refusal message it prints. It moved here when
 * `rawTools.test.ts` was split by behaviour.
 */
import { classifyRawCommand } from "../../../../admit/rawTools.js";

/**
 * Whether a command is blocked with the raw escape OFF (the default-deny path).
 *
 * @returns true when the classifier refuses the command with no escape set
 */
export function isBlocked({ command }: { command: string }): boolean {
  return classifyRawCommand({ allowRaw: false, command }).blocked;
}

/**
 * Assert a command is blocked and return its message (throws otherwise — keeps assertions unconditional).
 *
 * @returns the refusal message the classifier printed for the blocked command
 */
export function blockedMessage({ command }: { command: string }): string {
  const verdict = classifyRawCommand({ allowRaw: false, command });
  if (!verdict.blocked) {
    throw new Error(`expected blocked for: ${command}`);
  }
  return verdict.message;
}
