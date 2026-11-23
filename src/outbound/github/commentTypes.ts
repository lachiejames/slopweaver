/**
 * The GitHub top-level COMMENT vocabulary — a MESSAGE, deliberately not a reuse of the pull-request form.
 *
 * A pull-request description is a document with named cells and an executable contract
 * (`src/prformat/checkCore.ts` runs on every push); a comment lands in someone's activity feed once and is
 * never re-validated by CI. So it takes the shape `../linear/commentTypes.ts` already settled on for the
 * same distinction — one summary line above the fold, optional detail collapsed beneath it — rather than the
 * PR body's derived badges and reading-order sections.
 *
 * `summary` reuses {@link Content} and `detail` reuses `ProofBlockLeaf` from `./types.ts` rather than
 * inventing a second inline vocabulary: both are already typed, already escaped by `./render.ts`, and a
 * comment's detail is the same "prose, a fenced snippet, an extra screenshot" shape the PR body's Longer notes
 * already cover.
 *
 * Unlike the Linear comment form, the destination is NOT carried inside this artifact. `github label` and
 * `github thread` both address their target with `--repo`/`--number` on the command line rather than inside
 * `--form`, and this verb follows that convention rather than Linear's, so the form is the body alone.
 */
import type { ProofBlockLeaf } from "./legacy/types.js";
import type { Content } from "./types.js";

/** The body of one comment: one line above the fold, optional detail collapsed beneath it. */
export interface GithubCommentArtifact {
  /** The whole message above the fold — GitHub shows a comment inline in the activity feed and PR timeline. */
  readonly summary: Content;
  /** Optional ordered blocks, rendered inside a collapsed `<details>`. */
  readonly detail?: readonly ProofBlockLeaf[] | undefined;
}
