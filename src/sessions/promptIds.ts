/**
 * The prompts a Claude Code session has run, read from its own transcript — the key that joins a session to
 * the `api_request` telemetry it exported (`../claude/meteredSpend.ts`).
 *
 * `promptId` sits top-level on every `type:"user"` record, and every tool result carries the id of the prompt
 * that caused it, so a prompt usually appears several times. Read by line pattern rather than parsed, in the
 * `../supervisor/chairModel.ts` style: a tail read starts mid-line, and an unmatched line is simply skipped.
 */

/** One prompt a session ran, with the instant it first appears in what was read. */
export interface TranscriptPrompt {
  readonly promptId: string;
  readonly firstIso: string;
}

/**
 * Capture the first group of a pattern on one line.
 *
 * @param pattern the pattern, with one capturing group
 * @param line one transcript line
 * @returns the captured text, or undefined when the line does not carry it
 */
function capture({ pattern, line }: { pattern: RegExp; line: string }): string | undefined {
  const match = pattern.exec(line);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

/**
 * The newest distinct prompts in a transcript, oldest first.
 *
 * @param text transcript JSONL, whole or a tail
 * @param limit how many of the newest prompts to keep
 * @returns up to `limit` prompts, in the order the transcript first names them
 */
export function recentPromptIds({ text, limit }: { text: string; limit: number }): readonly TranscriptPrompt[] {
  const seen = new Map<string, string>();
  for (const line of text.split("\n")) {
    const promptId = capture({ line, pattern: /"promptId":"([^"]+)"/ });
    if (promptId === undefined || seen.has(promptId)) {
      continue;
    }
    const timestamp = capture({ line, pattern: /"timestamp":"([^"]+)"/ });
    if (timestamp === undefined) {
      continue;
    }
    seen.set(promptId, timestamp);
  }
  const prompts = [...seen].map(([promptId, firstIso]) => ({ firstIso, promptId }));
  if (limit <= 0) {
    return [];
  }
  return prompts.slice(-limit);
}
