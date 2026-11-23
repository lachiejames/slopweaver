/**
 * The PURE renderer: a {@link GithubCommentArtifact} in, the exact bytes of a top-level comment out.
 *
 * Reuses `./render.ts`'s `renderContent` and `renderProofBlock` verbatim — the same escaping, the same
 * collision-proof code fence — rather than a second copy for a second surface.
 */
import type { GithubCommentArtifact } from "./commentTypes.js";
import { renderProofBlock } from "./legacy/render.js";
import { renderContent } from "./render.js";

/** The `<summary>` label the collapsed detail block always carries. */
const DETAIL_SUMMARY = "Detail";

/**
 * The complete comment body.
 *
 * @param artifact the validated comment
 * @returns the exact bytes to send as the comment body
 */
export function renderCommentBody({ artifact }: { artifact: GithubCommentArtifact }): string {
  const summary = renderContent({ content: artifact.summary });
  if (artifact.detail === undefined || artifact.detail.length === 0) {
    return summary;
  }
  const inner = artifact.detail.map((block) => renderProofBlock({ block })).join("\n\n");
  return `${summary}\n\n<details>\n<summary>${DETAIL_SUMMARY}</summary>\n\n${inner}\n\n</details>`;
}
