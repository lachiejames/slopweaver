/**
 * The typed failures of reading Claude Code's transcript corpus.
 *
 * Three genuinely distinct kinds, and callers branch on all three: a missing session id is a caller
 * mistake that should print usage, an unreadable projects directory means the corpus is not where it was
 * expected and every verb here is inert, and an unreadable transcript is one row missing from an otherwise
 * good answer. Collapsing them to a display string would make a verb answer "nothing found" for the second,
 * which is precisely the misreading the retention line exists to prevent. A fourth, a session id two project
 * directories both hold, is raised only by the reader of the owner's words (`findOnlyTranscript`), where taking the first
 * copy could quote a stale one or miss a turn the other holds.
 */

/** `~/.claude/projects` could not be listed at all. */
export interface ProjectsDirUnreadableError {
  readonly code: "PROJECTS_DIR_UNREADABLE";
  readonly message: string;
  /** The directory that could not be listed. */
  readonly dir: string;
}

/** No project directory holds a transcript named after the session. */
export interface SessionNotFoundError {
  readonly code: "SESSION_NOT_FOUND";
  readonly message: string;
  /** The session id that was searched for. */
  readonly sessionId: string;
}

/** More than one project directory holds a transcript named after the session, so which one is its record is unknown. */
export interface SessionAmbiguousError {
  readonly code: "SESSION_AMBIGUOUS";
  readonly message: string;
  /** The session id that was searched for. */
  readonly sessionId: string;
  /** Every transcript found under that name. */
  readonly paths: readonly string[];
}

/** The transcript exists but could not be read. */
export interface TranscriptUnreadableError {
  readonly code: "TRANSCRIPT_UNREADABLE";
  readonly message: string;
  /** The transcript that could not be read. */
  readonly path: string;
  /** Whatever the filesystem threw, kept so a caller can report the errno rather than a paraphrase. */
  readonly cause?: unknown;
}

/** Every way reading this corpus fails. */
export type TranscriptSourceError =
  ProjectsDirUnreadableError | SessionAmbiguousError | SessionNotFoundError | TranscriptUnreadableError;

/** The factory every producer and every test constructs a {@link TranscriptSourceError} through. */
export const TranscriptSourceErrors = {
  projectsDirUnreadable: ({ dir, cause }: { dir: string; cause: unknown }): ProjectsDirUnreadableError => ({
    code: "PROJECTS_DIR_UNREADABLE",
    dir,
    message: `${dir} could not be listed (${String(cause)}) — Claude Code keeps every transcript under it, so nothing here can answer anything`,
  }),
  sessionAmbiguous: ({ sessionId, paths }: { sessionId: string; paths: readonly string[] }): SessionAmbiguousError => ({
    code: "SESSION_AMBIGUOUS",
    message: `${paths.length} transcripts are named ${sessionId}.jsonl (${paths.join(", ")}), so which one is that session's record is not known`,
    paths,
    sessionId,
  }),
  sessionNotFound: ({ sessionId }: { sessionId: string }): SessionNotFoundError => ({
    code: "SESSION_NOT_FOUND",
    message:
      sessionId === ""
        ? "no session id was given, so no transcript can be located"
        : `no transcript named ${sessionId}.jsonl exists under any project directory — the session may never have run here, or it may have aged out of retention`,
    sessionId,
  }),
  transcriptUnreadable: ({ path, cause }: { path: string; cause: unknown }): TranscriptUnreadableError => ({
    cause,
    code: "TRANSCRIPT_UNREADABLE",
    message: `${path} could not be read (${String(cause)})`,
    path,
  }),
} as const;
