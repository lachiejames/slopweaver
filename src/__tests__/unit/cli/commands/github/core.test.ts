/**
 * The `github pr` decisions, as pure functions.
 */
import { describe, expect, it } from "vitest";

import {
  doorRequestFor,
  dryRunLines,
  outcomeLines,
  parseGithubPrArgs,
  parseRepoSlug,
} from "../../../../../cli/commands/github/core.js";
import { GithubVerbErrors, githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { parsePrEdit, parsePrForm } from "../../../../../cli/commands/github/prFormParse.js";
import { productionGithubPrDeps } from "../../../../../cli/commands/github/run.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";

/**
 * Imported from the same fixture the CLI's `--form-example` flag prints, rather than a second hand-written
 * form — the whole point of `formExample.ts` is that the test and the CLI can never drift apart.
 */
const FORM = EXAMPLE_PR_FORM;

/** The closing line of every unknown-field refusal: each field an edit may name, in order. */
const EDIT_FIELDS_LINE =
  "this form's fields are: appendChecks, appendNotChecked, checkGroups, checks, explainer, notChecked, problemProof, " +
  "problemSeen, rerun, risk, solutionProof, title, visualProof";

/** The shortest invocation this parser still accepts, for the flags that are not about the input mode. */
const UPDATE_PROBE = ["update", "--edit", "{}", "--repo", "o/r", "--number", "1"] as const;

describe("argument parsing", () => {
  it("rejects a missing sub-command", () => {
    const parsed = parseGithubPrArgs({ argv: [] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error })[0] : "").toContain(
      "update|request-review|retarget",
    );
  });

  it("rejects `create`, which is `github stack push` now and is not a shape this parser still accepts", () => {
    const parsed = parseGithubPrArgs({ argv: ["create", "--form", "-"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error })[0] : "").toBe(
      "usage: slopweaver github pr <update|request-review|retarget> [...]",
    );
  });

  it("accepts --file on update as a third whole-replacement input", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--file", "/tmp/pr.md", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.fileSource : "unset").toBe("/tmp/pr.md");
  });

  it("refuses --edit and --file together on update", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--edit", "{}", "--file", "/tmp/pr.md", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain(
      "exactly ONE of --edit, --form or --file",
    );
  });

  it("mentions --pull among update's input modes when none was given", () => {
    const parsed = parseGithubPrArgs({ argv: ["update", "--repo", "o/r", "--number", "7"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain("--pull");
  });

  it("accepts --pull on update with only the address given", () => {
    const parsed = parseGithubPrArgs({ argv: ["update", "--pull", "--repo", "o/r", "--number", "7"] });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.pull : false).toBe(true);
  });

  it("accepts --pull with --out to name the destination file", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--pull", "--out", "/tmp/pulled.md", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.outPath : "unset").toBe("/tmp/pulled.md");
  });

  it("refuses --pull combined with --edit", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--pull", "--edit", "{}", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain(
      "--pull is read-only",
    );
  });

  it("refuses --pull combined with --file", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--pull", "--file", "/tmp/pr.md", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain(
      "--pull is read-only",
    );
  });

  it("requires --edit AND the branch locus for update", () => {
    const parsed = parseGithubPrArgs({ argv: ["update"] });
    expect(parsed.isOk()).toBe(false);
    const joined = parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "";
    expect(joined).toContain("--edit");
    expect(joined).toContain("--repo");
  });

  it("accepts a complete update invocation", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--edit", "{}", "--repo", "o/r", "--base", "main", "--head", "feature"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.address : undefined).toStrictEqual({
      base: "main",
      head: "feature",
      kind: "branch",
      owner: "o",
      repo: "r",
    });
  });

  it("carries --expect-head, the head a caller derived its edit at", () => {
    const sha = "a".repeat(40);
    const argv = ["update", "--edit", "{}", "--repo", "o/r", "--number", "7", "--expect-head", sha];
    expect(unwrap(parseGithubPrArgs({ argv })).expectHead).toBe(sha);
  });

  it("refuses an --expect-head that is not a full lowercase sha", () => {
    const argv = ["update", "--edit", "{}", "--repo", "o/r", "--number", "7", "--expect-head", "abc123"];
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubPrArgs({ argv })) }).join("\n")).toContain(
      "--expect-head must be a full 40-character lowercase commit sha",
    );
  });

  it("accepts a self-review-only update", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--self-review", "review.json", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.selfReviewSource : undefined).toBe("review.json");
  });

  it("refuses two stdin-backed inputs on update", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--edit", "-", "--self-review", "-", "--repo", "o/r", "--number", "7"],
    });
    expect(parsed).toEqual(
      err(
        GithubVerbErrors.argumentsRefused({
          reasons: ["--self-review and the description input cannot both read from stdin; pass one as inline JSON"],
        }),
      ),
    );
  });

  it("rejects an unknown flag", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubPrArgs({ argv: [...UPDATE_PROBE, "--nope"] })) }),
    ).toEqual(["unknown flag: --nope"]);
  });

  it("rejects the create-only flags outright, since they moved to `github stack push`", () => {
    for (const flag of ["--form-example", "--file-example", "--acknowledge-all"]) {
      expect(githubVerbErrorLines({ error: unwrapErr(parseGithubPrArgs({ argv: [...UPDATE_PROBE, flag] })) })).toEqual([
        `unknown flag: ${flag}`,
      ]);
    }
    for (const [flag, value] of [
      ["--cwd", "/repo"],
      ["--remote", "upstream"],
      ["--acknowledge", "base-moved"],
      ["--reason", "why"],
    ]) {
      expect(
        githubVerbErrorLines({ error: unwrapErr(parseGithubPrArgs({ argv: [...UPDATE_PROBE, flag!, value!] })) }),
      ).toEqual([`unknown flag: ${flag}`, `unexpected argument: ${value}`]);
    }
  });

  it("rejects a malformed repo slug", () => {
    const parsed = parseGithubPrArgs({
      argv: ["update", "--edit", "{}", "--repo", "not-a-slug", "--base", "m", "--head", "h"],
    });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain("owner/name");
  });
});

describe("parseRepoSlug", () => {
  it("splits owner and name", () => {
    expect(parseRepoSlug({ slug: "owner/name" })).toStrictEqual({ owner: "owner", repo: "name" });
  });

  it("refuses a three-segment path or a bare name", () => {
    expect(parseRepoSlug({ slug: "a/b/c" })).toBe(undefined);
    expect(parseRepoSlug({ slug: "name" })).toBe(undefined);
  });
});

describe("form and edit parsing", () => {
  it("reports invalid JSON as such rather than as a schema failure", () => {
    const parsed = parsePrForm({ raw: "{oops" });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error })[0] : "").toContain("not valid JSON");
  });

  it("reports schema violations with their field path", () => {
    const parsed = parsePrForm({ raw: JSON.stringify({ ...FORM, title: "a\nb" }) });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain("title:");
  });

  it("accepts a valid form", () => {
    expect(parsePrForm({ raw: JSON.stringify(FORM) }).isOk()).toBe(true);
  });

  it("refuses an edit that is not an object", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parsePrEdit({ raw: "[]" })) })).toEqual([
      "--edit must be a JSON object naming the fields to change",
    ]);
    expect(githubVerbErrorLines({ error: unwrapErr(parsePrEdit({ raw: '"x"' })) })).toEqual([
      "--edit must be a JSON object naming the fields to change",
    ]);
  });

  it("accepts an empty edit, which is the identity", () => {
    expect(parsePrEdit({ raw: "{}" }).isOk()).toBe(true);
  });
});

describe("dry run", () => {
  it("prints the body, the gate's verdict and the routing", () => {
    const lines = dryRunLines({ body: "THE BODY", form: FORM, validation: { errors: [], ok: true } }).join("\n");
    expect(lines).toContain("THE BODY");
    expect(lines).toContain("pr-format: ACCEPTS this title and body (CI's shape check and secret scan)");
    expect(lines).toContain("acme/widgets  a-branch -> main");
    expect(lines).toContain("(draft)");
  });

  // The two sub-commands no longer make the same promise -- create's dry run is offline, update's reads -- so
  // this SHARED helper must not claim either. A live run printed "no network" directly underneath an update
  // that had just read the pull request, which is output contradicting itself in the same breath.
  it("makes no claim about the network, because its two callers differ", () => {
    const lines = dryRunLines({ body: "THE BODY", form: FORM, validation: { errors: [], ok: true } }).join("\n");
    expect(lines).not.toContain("no network");
    expect(lines).not.toContain("no token resolved");
  });

  it("shows each gate error when the body would be rejected", () => {
    const lines = dryRunLines({
      body: "b",
      form: FORM,
      validation: { errors: ["no explainer paragraph"], ok: false },
    }).join("\n");
    expect(lines).toContain("pr-format: REJECTS this title and body:");
    expect(lines).toContain("no explainer paragraph");
  });
});

describe("outcome reporting", () => {
  it("reports a created pull request as one line naming its number and address", () => {
    expect(outcomeLines({ outcome: { kind: "created", number: 7, url: "https://x/7" } })).toStrictEqual([
      "opened #7  https://x/7",
    ]);
  });

  it("sends an unconfirmed create back for another attempt, and names the door a read cannot settle", () => {
    const lines = outcomeLines({
      outcome: { detail: "the call failed", kind: "unconfirmed", locus: "o/r#main...f" },
    }).join("\n");
    expect(lines).toContain("UNCONFIRMED");
    expect(lines).toContain("run this again");
    expect(lines).toContain("github pr release-reservation");
    expect(lines).not.toContain("failed to create");
  });

  it("names the existing pull request on a duplicate", () => {
    const lines = outcomeLines({
      outcome: { existing: 12, kind: "duplicate", locus: "o/r#main...f", repo: "o/r" },
    }).join("\n");
    expect(lines).toContain("already reserved by #12");
  });

  it("names the field-edit update for the pull request a duplicate cites, its repository quoted for paste", () => {
    expect(
      outcomeLines({
        outcome: { existing: 44, kind: "duplicate", locus: "acme/w$x#main...fix", repo: "Acme/w$x" },
      }),
    ).toStrictEqual([
      "refused: acme/w$x#main...fix is already reserved by #44. A second pull request for the same branches would be a duplicate, not a retry.",
      "To bring #44 up to date instead, put only the fields to change in edit.json and run:",
      "  slopweaver github pr update --repo 'Acme/w$x' --number 44 --edit - < edit.json",
      "  A new walkthrough rides the same call as inline JSON: --self-review '<json>'.",
    ]);
  });

  it("names no update for a recorded number `pr update --number` would refuse", () => {
    expect(
      outcomeLines({ outcome: { existing: 0, kind: "duplicate", locus: "o/r#main...f", repo: "o/r" } }),
    ).toStrictEqual([
      "refused: o/r#main...f is already reserved by #0. A second pull request for the same branches would be a duplicate, not a retry.",
    ]);
  });

  it("names no update when the reservation cites no pull request", () => {
    expect(
      outcomeLines({ outcome: { existing: undefined, kind: "duplicate", locus: "o/r#main...f", repo: "o/r" } }),
    ).toStrictEqual([
      "refused: o/r#main...f is already reserved. A second pull request for the same branches would be a duplicate, not a retry.",
    ]);
  });

  it("passes a refusal reason through verbatim", () => {
    expect(outcomeLines({ outcome: { kind: "refused", reason: "because of X" } }).join("\n")).toContain("because of X");
  });
});

describe("the door request", () => {
  it("never marks an update as work-creating — re-rendering a description queues nobody", () => {
    expect(doorRequestFor({ home: "/h", locus: "l", verb: "update" }).meta.createsWorkItem).toBe(false);
  });

  it("declares an external write that claims no approval", () => {
    const request = doorRequestFor({ home: "/h", locus: "l", verb: "update" });
    expect(request.meta.effect).toBe("external-write");
    expect(request.meta.requiresApproval).toBe(false);
    expect(request.action).toStrictEqual({ kind: "verb", noun: "github", verb: "pr update" });
  });
});

describe("the production form reader — the gold-proof bug", () => {
  /**
   * `--form`/`--edit` take the JSON ITSELF, or `-` for stdin. An earlier cut read the argument as a FILE
   * PATH, so an inline form went to `open()` and died with ENAMETOOLONG. Every unit test injected its own
   * `readForm`, so nothing caught it until the verb was driven for real against GitHub.
   *
   * The two write verbs must agree here, because a single downstream caller fills forms for both.
   */
  it("returns the source verbatim as the JSON, rather than reading it as a path", () => {
    const deps = productionGithubPrDeps();
    expect(deps.readForm({ source: '{"a":1}' })).toBe('{"a":1}');
  });

  it("does not throw on a long inline form, which a path read would", () => {
    const long = JSON.stringify({ text: "x".repeat(5000) });
    expect(productionGithubPrDeps().readForm({ source: long })).toBe(long);
  });
});

describe("parsePrEdit — an undeclared field is refused by name, not silently ignored", () => {
  // The bug this pins shipped: `applyEdit` reads only the keys it knows, so a misspelled field changed
  // nothing, PATCHed an unchanged body and printed `updated`. The caller was told a change had happened.
  it("refuses a misspelled explainer, which would otherwise be a no-op reported as success", () => {
    const parsed = parsePrEdit({ raw: JSON.stringify({ explaner: [{ kind: "text", text: "the explainer" }] }) });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      'unknown field "explaner" — REFUSED, not ignored. Did you mean "explainer"?\n' + EDIT_FIELDS_LINE,
    ]);
  });

  it("names the offending key so the caller can fix it", () => {
    const parsed = parsePrEdit({ raw: JSON.stringify({ problems: [{ kind: "text", text: "x" }] }) });
    expect(parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }).join(" ") : "").toContain("problems");
  });

  it("refuses draft by name, because a PATCH cannot change draft state and would report success anyway", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parsePrEdit({ raw: JSON.stringify({ draft: false }) })) })).toEqual([
      'unknown field "draft" — REFUSED, not ignored. No field here is close to it, so it is probably a field ' +
        "from another schema.\n" +
        EDIT_FIELDS_LINE,
    ]);
  });

  it("refuses a field whose VALUE is the wrong shape", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parsePrEdit({ raw: JSON.stringify({ title: "a title\nwith a newline" }) })),
      }),
    ).toEqual(["title: the pull-request title renders as ONE line, so a newline would break it. Remove it."]);
    expect(
      githubVerbErrorLines({ error: unwrapErr(parsePrEdit({ raw: JSON.stringify({ appendChecks: [] }) })) }),
    ).toEqual(["appendChecks: Too small: expected array to have >=1 items"]);
    expect(
      githubVerbErrorLines({
        error: unwrapErr(
          parsePrEdit({ raw: JSON.stringify({ problemSeen: { ...FORM.problemSeen, on: "2026-02-30" } }) }),
        ),
      }),
    ).toEqual(["problemSeen.on: must be a real YYYY-MM-DD calendar day (UTC)"]);
  });

  it("still accepts every real field, so the edit stays partial", () => {
    const accepted = [
      { title: "a new title" },
      { explainer: [{ kind: "text", text: "the explainer" }] },
      { checks: [[{ kind: "text", text: "a check" }]] },
      { appendChecks: [[{ kind: "text", text: "another check" }]] },
      { appendNotChecked: [{ check: [{ kind: "text", text: "a" }], why: [{ kind: "text", text: "b" }] }] },
      { problemProof: FORM.problemProof },
      { solutionProof: FORM.solutionProof },
      { risk: FORM.risk },
      { problemSeen: FORM.problemSeen },
      { rerun: [] },
      { visualProof: "nothing-on-screen" },
    ];
    const results = accepted.map((edit) => parsePrEdit({ raw: JSON.stringify(edit) }).isOk());
    expect(results).toStrictEqual(accepted.map(() => true));
  });

  it("carries an explainer through unchanged", () => {
    expect(unwrap(parsePrEdit({ raw: JSON.stringify({ explainer: FORM.explainer }) })).explainer).toStrictEqual(
      FORM.explainer,
    );
  });

  it("refuses a field that is both set and appended to, since the two would disagree about what it ends as", () => {
    const parsed = parsePrEdit({ raw: JSON.stringify({ appendChecks: FORM.checks, checks: FORM.checks }) });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "appendChecks: appendChecks adds to checks, and this edit also sets checks. Put every item in checks to " +
        "replace it, or use appendChecks alone to add after what is there",
    ]);
  });
});

describe("outcomeLines — a no-op reports unchanged, never updated", () => {
  // The defect: a valid --edit that merged to the bytes already live PATCHed identical bytes and printed
  // `updated`. A change was reported that never happened, on the mode the docs steer callers toward.
  it("names the pull request and says nothing was sent", () => {
    const lines = outcomeLines({ outcome: { kind: "unchanged", number: 214, url: "https://x.test/pr/214" } }).join(
      "\n",
    );
    expect(lines).toContain("unchanged #214");
    expect(lines).toContain("nothing was sent");
  });

  it("does NOT say updated, which is the whole point", () => {
    const lines = outcomeLines({ outcome: { kind: "unchanged", number: 214, url: "https://x.test/pr/214" } }).join(
      "\n",
    );
    expect(lines).not.toContain("updated");
  });

  it("still says updated when a write actually landed", () => {
    const lines = outcomeLines({ outcome: { kind: "updated", number: 214, url: "https://x.test/pr/214" } }).join("\n");
    expect(lines).toContain("updated #214");
  });
});
