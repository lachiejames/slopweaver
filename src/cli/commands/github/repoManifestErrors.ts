/**
 * The settings-manifest half of {@link GithubVerbErrors}: a label the apply would have to overwrite, and an apply
 * that stopped part-way. Composed into the one factory by `./errors.ts`; import that, not this.
 *
 * Neither message advises sending the old approval again. A stop names every section confirmed so far, says that
 * nothing was rolled back, and routes to a fresh preview, whose digest is computed over what is there now.
 */
import type { GithubFactRefusedError, GithubWriteUnconfirmedError } from "./errors.js";

/** One label whose name is taken by a label that differs. */
export interface LabelConflict {
  readonly name: string;
  readonly live: string;
  readonly desired: string;
}

/** The factory methods for the settings-manifest apply, composed into `GithubVerbErrors`. */
export const githubRepoManifestErrorFactories = {
  repoManifestIncomplete: ({
    fullName,
    failedStep,
    landed,
    waiting,
    causes,
  }: {
    fullName: string;
    failedStep: string;
    landed: readonly string[];
    waiting: readonly string[];
    /** GitHub's own words for each failed send or read at that step, empty when every call answered. */
    causes: readonly string[];
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `the settings apply on ${fullName} stopped at "${failedStep}" ` +
      `(${landed.length === 0 ? "nothing was confirmed" : `confirmed: ${landed.join(", ")}`}` +
      `${waiting.length === 0 ? "" : `; still waiting for public: ${waiting.join(", ")}`}). Nothing is rolled ` +
      "back; preview again for a fresh digest over what is there now, never re-send the old approval" +
      (causes.length === 0 ? "" : `. GitHub said: ${causes.join("; ")}`),
    subject: fullName,
  }),
  repoManifestLabelConflict: ({
    fullName,
    conflicts,
  }: {
    fullName: string;
    conflicts: readonly LabelConflict[];
  }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${fullName} already has ${conflicts.map((c) => `a label "${c.name}" (${c.live}, wanted ${c.desired})`).join(", ")}; ` +
      "the apply creates labels and never changes an existing one, so nothing was sent. Rename or remove the label " +
      "in the apply artifact, or change it on GitHub, then preview again",
    subject: fullName,
  }),
} as const;
