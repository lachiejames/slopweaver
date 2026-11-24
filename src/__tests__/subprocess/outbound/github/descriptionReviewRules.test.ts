/*
 * The written rules a description is judged against, read over real git: on this source repository, the committed
 * blob at the resolved head, so a pull request editing a rule is judged against the edited text; a rule absent there
 * refuses by name and no installed copy stands in; any other repository reads the installed tree.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SOURCE_REPOSITORY } from "../../../../hygiene/ownRepository.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { rulesSha256Of } from "../../../../outbound/github/descriptionReview.js";
import { DescriptionReviewErrors } from "../../../../outbound/github/descriptionReviewErrors.js";
import {
  type DescriptionUnderReview,
  descriptionManifestFor,
} from "../../../../outbound/github/descriptionReviewGate.js";
import { readDescriptionRules } from "../../../../outbound/github/descriptionReviewRules.js";
import { DESCRIPTION_RULE_FILES } from "../../../../outbound/github/descriptionReviewTypes.js";
import { gitInTemp } from "../../../tempGitRepo.js";

/** A fixed identity, no signing and no hooks, for every command that writes a commit. */
const IDENTITY: readonly string[] = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

const EDITED_RULE = DESCRIPTION_RULE_FILES[0]!;

/** Write every rule file under a root, each saying which tree it is from. */
function writeRules({ root, label }: { root: string; label: string }): void {
  for (const file of DESCRIPTION_RULE_FILES) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `# ${file}\n\nThe ${label} rule.\n`);
  }
}

/** Commit everything in a working tree. */
function commitAll({ repo, message }: { repo: string; message: string }): void {
  gitInTemp({ args: ["add", "--all"], cwd: repo });
  gitInTemp({ args: [...IDENTITY, "commit", "--quiet", "--no-verify", "-m", message], cwd: repo });
}

describe("descriptionManifestFor's written rules", () => {
  let root = "";
  let repo = "";
  let installed = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sw-desc-rules-"));
    repo = join(root, "repo");
    installed = join(root, "installed");
    mkdirSync(repo);
    writeRules({ label: "installed", root: installed });
    gitInTemp({ args: ["init", "--quiet", "--initial-branch=main"], cwd: repo });
    writeFileSync(join(repo, ".gitattributes"), "* -text\n");
    writeRules({ label: "base", root: repo });
    commitAll({ message: "base", repo });
    gitInTemp({ args: ["checkout", "--quiet", "-b", "feature"], cwd: repo });
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** The description under review, on the feature branch against main. */
  function description({ repository }: { repository: string }): DescriptionUnderReview {
    return {
      baseBranch: "main",
      baseRef: "main",
      body: "Edits a rule.\n",
      comments: [],
      existingComments: [],
      headRef: "feature",
      images: [],
      installedRulesRoot: installed,
      repoDir: repo,
      repository,
      title: "docs: edit a rule",
    };
  }

  /** Commit one rule's new contents on the feature branch, and answer the head commit. */
  function editRule({ contents }: { contents: string }): string {
    writeFileSync(join(repo, EDITED_RULE), contents);
    commitAll({ message: "edit a rule", repo });
    return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
  }

  it("reads this source repository's rules at the head, so an edited rule is judged as edited", () => {
    const headSha = editRule({ contents: "# edited\n" });
    const reading = unwrap(descriptionManifestFor({ description: description({ repository: SOURCE_REPOSITORY }) }));
    expect([reading.rules[0], reading.rules[1]!.contents, reading.rulesOrigin]).toStrictEqual([
      { contents: "# edited\n", path: EDITED_RULE },
      `# ${DESCRIPTION_RULE_FILES[1]!}\n\nThe base rule.\n`,
      { headRef: "feature", headSha, kind: "head" },
    ]);
  });

  it("binds the same rules digest at prepare and at the write gate, over the head's bytes", () => {
    editRule({ contents: "# edited\n" });
    const under = description({ repository: SOURCE_REPOSITORY });
    const first = unwrap(descriptionManifestFor({ description: under }));
    const second = unwrap(descriptionManifestFor({ description: under }));
    expect([second.manifestSha256, second.manifest.rulesSha256]).toStrictEqual([
      first.manifestSha256,
      rulesSha256Of({ files: first.rules }),
    ]);
  });

  it("reads at the resolved commit, never the ref, so a branch that moves on does not swap the rules", () => {
    const resolved = editRule({ contents: "# resolved\n" });
    editRule({ contents: "# pushed after resolution\n" });
    const reading = unwrap(
      readDescriptionRules({ source: { headRef: "feature", headSha: resolved, kind: "head", repoDir: repo } }),
    );
    expect([reading.files[0]!.contents, reading.origin]).toStrictEqual([
      "# resolved\n",
      { headRef: "feature", headSha: resolved, kind: "head" },
    ]);
  });

  it("reads the committed blob byte for byte, never the working tree", () => {
    editRule({ contents: "line one\r\nline two" });
    writeFileSync(join(repo, EDITED_RULE), "an uncommitted edit\n");
    const reading = unwrap(descriptionManifestFor({ description: description({ repository: SOURCE_REPOSITORY }) }));
    expect(reading.rules[0]!.contents).toBe("line one\r\nline two");
  });

  it("refuses a rule the head deleted by name, and never substitutes the installed copy", () => {
    gitInTemp({ args: ["rm", "--quiet", "--", EDITED_RULE], cwd: repo });
    commitAll({ message: "delete a rule", repo });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    const refused = unwrapErr(descriptionManifestFor({ description: description({ repository: SOURCE_REPOSITORY }) }));
    expect(refused).toStrictEqual(
      DescriptionReviewErrors.ruleAbsentAtHead({ headRef: "feature", headSha, path: EDITED_RULE }),
    );
  });

  it("reads another repository's rules from the installed tree, whatever its head carries", () => {
    editRule({ contents: "# edited\n" });
    const reading = unwrap(descriptionManifestFor({ description: description({ repository: "acme/widgets" }) }));
    expect([reading.rules[0]!.contents, reading.rulesOrigin]).toStrictEqual([
      `# ${EDITED_RULE}\n\nThe installed rule.\n`,
      { kind: "installed" },
    ]);
  });
});
