/**
 * The usage lines of `talk call-thread` and `talk call-thread-append` — a leaf importing nothing, so the `talk`
 * manifest can quote them without loading a parser (`.claude/rules/area-cli.md`).
 */

/** The usage `talk call-thread` prints. */
export const TALK_CALL_THREAD_USAGE = [
  "usage: slopweaver talk call-thread --call <uuid> [--from <n>] [--limit <n>] [--home <dir>] [--json]",
  "       one console call's Codex thread journal, an audit read: what the thread was told, each turn frame and",
  "       completed item, and every tool answer handed to it. --from is the first entry's zero-based index (default",
  "       0), --limit how many entries (default 1, at most 10, since one entry can be 8 MiB); page on until nextFrom",
  "       is null. Inline images and audio are kept as a digest, secrets masked; each entry says what was altered",
].join("\n");

/** The usage `talk call-thread-append` prints. */
export const TALK_CALL_THREAD_APPEND_USAGE = [
  "usage: slopweaver talk call-thread-append --call <uuid> --entries-file <jsonl|-> [--console-root <dir>",
  "       --console-port <n> --console-default-port <n>] [--home <dir>] [--json]",
  "       the console server's writer of a call's thread journal (talk/threads/<callId>.jsonl): masks secrets,",
  "       replaces inline binary by its digest, fits each entry under 8 MiB and skips a writeId already written.",
  "       --entries-file - reads the batch from stdin, which is how the console sends it: unmasked, it never",
  "       touches disk before the masking",
].join("\n");
