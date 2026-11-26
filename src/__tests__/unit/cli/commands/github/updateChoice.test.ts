/**
 * `chooseUpdate` directly: a partial `--edit` merges into the recovered description and carries any third-party
 * trailing bytes; a whole `--form`/`--file` takes the live shell and says out loud what it ignored or could not
 * check.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chooseUpdate } from "../../../../../cli/commands/github/updateChoice.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { bodyHash } from "../../../../../outbound/github/prLedger.js";
import { renderPrBody } from "../../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An empty state home: no ledger record, so an `--edit` recovers from the live body. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "update-choice-"));
  homes.push(dir);
  return dir;
}

/** The example draft, addressed to this file's pull request. */
const DRAFT: PrFormDraft = {
  ...EXAMPLE_PR_FORM,
  target: { base: "main", head: "feature", owner: "o", repo: "r" },
  title: "a title",
};

/**
 * The example draft as a live-body parse recovers it: the badge carries only the top risk item, so a form
 * recovered from the body alone, with no ledger record, holds that one.
 */
const RECOVERED: PrFormDraft = { ...DRAFT, risk: { items: [DRAFT.risk.items[0]!] } };

/** `draft` checked for a write and rendered — the bytes a live description carries. */
function rendered({ draft }: { draft: PrFormDraft }): string {
  return unwrap(renderPrBody({ form: unwrap(stampForWrite({ draft, today: "2026-09-30" })) }));
}

/** A live pull request carrying `body`; drafted exactly as the example is. */
function live({ body, draft = true }: { body: string; draft?: boolean }): WrittenPr {
  return {
    authorId: 41,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body,
    commits: 1,
    draft,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "a".repeat(40) },
    htmlUrl: "https://github.com/o/r/pull/7",
    mergedAtIso: undefined,
    nodeId: "PR_7",
    number: 7,
    stack: undefined,
    state: "open",
    title: "a title",
    updatedAtIso: "2026-09-30T00:00:00Z",
  };
}

describe("chooseUpdate — a partial --edit", () => {
  it("merges into the recovered description, with nothing to say", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { edit: { title: "a new title" }, kind: "edit" },
      live: live({ body: rendered({ draft: DRAFT }) }),
    });
    expect(chosen).toStrictEqual({
      draft: { ...RECOVERED, title: "a new title" },
      notices: [],
      pasted: [],
      trailing: "",
      wholesale: false,
    });
  });

  it("carries a third-party block appended after the description, to be re-sent byte for byte", () => {
    const footer = "\n\n---\nAppended by a release bot.\n";
    const chosen = chooseUpdate({
      home: home(),
      input: { edit: { title: "a new title" }, kind: "edit" },
      live: live({ body: `${rendered({ draft: DRAFT })}${footer}` }),
    });
    expect(chosen).toStrictEqual({
      draft: { ...RECOVERED, title: "a new title" },
      notices: [],
      pasted: [],
      trailing: footer,
      wholesale: false,
    });
  });

  it("refuses when the live description has no C3 form to merge into", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { edit: { title: "a new title" }, kind: "edit" },
      live: live({ body: "a hand-written description" }),
    });
    expect("reason" in chosen).toBe(true);
    expect(JSON.stringify(chosen)).toContain("a partial --edit needs the description's current form to merge into");
  });

  it("keeps a screenshot pasted between two sections, keyed to the block it followed, and merges around it", () => {
    const paste =
      '<img width="1512" height="982" alt="Image" src="https://github.com/user-attachments/assets/abc-1" />';
    const problem = "<p>The short export was reported in a file, and nothing on screen changes.</p>";
    const body = rendered({ draft: DRAFT }).replace(problem, `${problem}\n\n${paste}`);
    expect(body).toContain(paste);
    const chosen = chooseUpdate({
      home: home(),
      input: { edit: { title: "a new title" }, kind: "edit" },
      live: live({ body }),
    });
    expect(chosen).toStrictEqual({
      draft: { ...RECOVERED, title: "a new title" },
      notices: [],
      pasted: [{ after: "problem-proof", occurrence: 1, raw: paste }],
      trailing: "",
      wholesale: false,
    });
  });
});

describe("chooseUpdate — a whole --form or --file", () => {
  it("takes the live shell, so an identical form can stay a no-op", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { form: DRAFT, kind: "form" },
      live: live({ body: rendered({ draft: DRAFT }) }),
    });
    expect(chosen).toStrictEqual({ draft: DRAFT, notices: [], pasted: [], trailing: "", wholesale: true });
  });

  it("states that a draft-state change was ignored rather than dropping it silently", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { form: { ...DRAFT, draft: false }, kind: "form" },
      live: live({ body: rendered({ draft: DRAFT }) }),
    });
    expect(chosen).toStrictEqual({
      draft: DRAFT,
      notices: [
        "note: draft state is not changeable through this API, so #7 stays a draft and the form's draft field was ignored",
      ],
      pasted: [],
      trailing: "",
      wholesale: true,
    });
  });

  it("states a draft form was ignored against a pull request that is ready for review", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { form: DRAFT, kind: "form" },
      live: live({ body: rendered({ draft: DRAFT }), draft: false }),
    });
    expect(chosen).toStrictEqual({
      draft: { ...DRAFT, draft: false },
      notices: [
        "note: draft state is not changeable through this API, so #7 stays ready for review and the form's draft " +
          "field was ignored",
      ],
      pasted: [],
      trailing: "",
      wholesale: true,
    });
  });

  it("advises when a --file carries no pulled-body-hash, because drift was not checked", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { form: DRAFT, fromFile: true, kind: "form" },
      live: live({ body: rendered({ draft: DRAFT }) }),
    });
    expect(chosen).toStrictEqual({
      draft: DRAFT,
      notices: [
        "note: this file carries no pulled-body-hash, so the live description was NOT checked for drift before " +
          "sending — if you meant to edit an existing description, `--pull` it first",
      ],
      pasted: [],
      trailing: "",
      wholesale: true,
    });
  });

  it("refuses a pulled file whose digest no longer matches the live description", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { form: DRAFT, fromFile: true, kind: "form", pulledBodyHash: bodyHash({ body: "an older body" }) },
      live: live({ body: rendered({ draft: DRAFT }) }),
    });
    expect(chosen).toStrictEqual({
      reason:
        "the live description has changed since this file was pulled — re-run `pr update --pull` to get the " +
        "current description, redo your edit on top of it, and try again",
    });
  });

  it("refuses a form addressed to a different branch than the live pull request", () => {
    const chosen = chooseUpdate({
      home: home(),
      input: { form: { ...DRAFT, target: { ...DRAFT.target, head: "elsewhere" } }, kind: "form" },
      live: live({ body: rendered({ draft: DRAFT }) }),
    });
    expect("reason" in chosen).toBe(true);
    expect(JSON.stringify(chosen)).toContain("elsewhere");
  });
});
