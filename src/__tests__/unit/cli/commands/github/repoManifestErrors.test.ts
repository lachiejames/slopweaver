/**
 * The settings apply's two failures: a stop names what was confirmed, what still waits for public and GitHub's own
 * words, says nothing was rolled back and never advises re-sending the old approval; a label conflict names each
 * label taken and that nothing was sent. Both are composed into the one `GithubVerbErrors` factory.
 */
import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { githubRepoManifestErrorFactories } from "../../../../../cli/commands/github/repoManifestErrors.js";

describe("repoManifestIncomplete", () => {
  it("names a stop with nothing confirmed and nothing waiting, and no GitHub words when every call answered", () => {
    const error = githubRepoManifestErrorFactories.repoManifestIncomplete({
      causes: [],
      failedStep: "set the topics",
      fullName: "acme/widget",
      landed: [],
      waiting: [],
    });

    expect(error).toStrictEqual({
      code: "WRITE_UNCONFIRMED",
      message:
        'the settings apply on acme/widget stopped at "set the topics" (nothing was confirmed). Nothing is rolled ' +
        "back; preview again for a fresh digest over what is there now, never re-send the old approval",
      subject: "acme/widget",
    });
  });

  it("names every confirmed step, every waiting section and each of GitHub's causes", () => {
    const error = githubRepoManifestErrorFactories.repoManifestIncomplete({
      causes: ["send: HTTP 422", "read-back: HTTP 404"],
      failedStep: 'create the label "ready"',
      fullName: "acme/widget",
      landed: ["set the description", "set the topics"],
      waiting: ["secret-scanning"],
    });

    expect(error.message).toBe(
      'the settings apply on acme/widget stopped at "create the label "ready"" ' +
        "(confirmed: set the description, set the topics; still waiting for public: secret-scanning). Nothing is " +
        "rolled back; preview again for a fresh digest over what is there now, never re-send the old approval. " +
        "GitHub said: send: HTTP 422; read-back: HTTP 404",
    );
  });

  it("is the factory GithubVerbErrors carries", () => {
    expect(GithubVerbErrors.repoManifestIncomplete).toBe(githubRepoManifestErrorFactories.repoManifestIncomplete);
  });
});

describe("repoManifestLabelConflict", () => {
  it("names each label taken, as it stands and as wanted, and that nothing was sent", () => {
    const error = githubRepoManifestErrorFactories.repoManifestLabelConflict({
      conflicts: [
        { desired: '#0e8a16, "Ready to land"', live: "#ededed, no description", name: "ready" },
        { desired: "#d73a4a, no description", live: '#b60205, "Broken"', name: "Bug" },
      ],
      fullName: "acme/widget",
    });

    expect(error).toStrictEqual({
      code: "FACT_REFUSED",
      message:
        'acme/widget already has a label "ready" (#ededed, no description, wanted #0e8a16, "Ready to land"), ' +
        'a label "Bug" (#b60205, "Broken", wanted #d73a4a, no description); the apply creates labels and never ' +
        "changes an existing one, so nothing was sent. Rename or remove the label in the apply artifact, or change " +
        "it on GitHub, then preview again",
      subject: "acme/widget",
    });
  });

  it("is the factory GithubVerbErrors carries", () => {
    expect(GithubVerbErrors.repoManifestLabelConflict).toBe(githubRepoManifestErrorFactories.repoManifestLabelConflict);
  });
});
