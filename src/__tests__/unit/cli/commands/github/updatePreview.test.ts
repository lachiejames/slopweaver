/**
 * `previewedUpdate` is what a `pr update` preview shows and what the door then refuses on, so the secret scan CI's
 * `pr-format` runs has to fire here too — and the third-party trailing region it carries is re-appended, not
 * scanned, because it is already on GitHub.
 */
import { describe, expect, it } from "vitest";

import { noPublicationFindings } from "../../../../../cli/commands/github/prRenderGate.js";
import type { ChosenUpdate } from "../../../../../cli/commands/github/updateChoice.js";
import { previewedUpdate } from "../../../../../cli/commands/github/updatePreview.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { ok } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { TitleShapePolicy } from "../../../../../outbound/github/titleShape.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";

/** A literal secret no pattern in `scan.ts` can express — the shape the private denylist exists for. */
const DENYLIST = ["hunter2-legacy-passphrase"];

/** No repository here carries a title shape, so a title is held only by the PR gate under test. */
const POLICY = ok<TitleShapePolicy>({ repositoryShapes: {}, selfRepository: "acme/slopweaver" });

const TODAY = new Date("2026-10-06T00:00:00.000Z");

/** The pull request as read before the door, carrying a body slopweaver did not write. */
const LIVE: WrittenPr = {
  authorId: 1,
  baseRef: "main",
  baseRepoFullName: "o/r",
  body: "an old hand-written description",
  commits: 1,
  draft: true,
  head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "abc123" },
  htmlUrl: "https://example.test/o/r/pull/7",
  mergedAtIso: undefined,
  nodeId: "PR7",
  number: 7,
  stack: undefined,
  state: "open",
  title: "an old title",
  updatedAtIso: "2026-10-05T00:00:00Z",
};

/** A whole-form update carrying `trailing` after the description, and any `pasted` media to put back. */
function chosen({
  draft,
  pasted = [],
  trailing,
}: {
  draft: PrFormDraft;
  pasted?: ChosenUpdate["pasted"];
  trailing: string;
}): ChosenUpdate {
  return { draft, notices: [], pasted, trailing, wholesale: pasted.length === 0 };
}

/** A screenshot as github.com's editor writes one, on a synthetic attachment id. */
const PASTE = '<img width="1512" height="982" alt="Image" src="https://github.com/user-attachments/assets/abc-1" />';

/** The example form's problem-proof paragraph, which {@link PASTE} is pasted after. */
const PROBLEM = "<p>The short export was reported in a file, and nothing on screen changes.</p>";

describe("previewedUpdate", () => {
  it("is ready on a clean draft, and sends the rendered body with the trailing bytes re-appended", () => {
    const trailing = "\n\n<!-- a bot footer -->";
    const preview = previewedUpdate({
      chosen: chosen({ draft: EXAMPLE_PR_FORM, trailing }),
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      titlePolicy: POLICY,
      draft: EXAMPLE_PR_FORM,
      live: LIVE,
      today: TODAY,
    });
    expect(preview.kind).toBe("ready");
    const ready = preview as Extract<typeof preview, { kind: "ready" }>;
    expect(ready.body).toBe(`${ready.rendered.body}${trailing}`);
    expect(ready.notices).toStrictEqual([
      `note: ${String(trailing.length)} bytes follow this description that slopweaver did not write (a bot or a ` +
        "human appended them) — they are preserved byte for byte and are not checked by the pull-request format gate",
    ]);
  });

  it("refuses a title carrying a denylisted term, naming the PR gate", () => {
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, title: "rotate hunter2-legacy-passphrase" };
    expect(
      previewedUpdate({
        chosen: chosen({ draft, trailing: "" }),
        denylist: DENYLIST,
        installationIdentifiers: undefined,
        publicationScan: noPublicationFindings,
        draft,
        live: LIVE,
        titlePolicy: POLICY,
        today: TODAY,
      }),
    ).toStrictEqual({
      kind: "refused",
      reason:
        "the resulting body fails the PR gate: PR title contains a denylisted term at line 1 — remove it (the " +
        "matched text is redacted from this log).",
    });
  });

  it("refuses on what the publication scan finds in the exact title and body, naming the PR gate", () => {
    const seen: string[] = [];
    const preview = previewedUpdate({
      chosen: chosen({ draft: EXAMPLE_PR_FORM, trailing: "" }),
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: ({ title }) => {
        seen.push(title);
        return ["a FIXTURE finding the scan raised"];
      },
      titlePolicy: POLICY,
      draft: EXAMPLE_PR_FORM,
      live: LIVE,
      today: TODAY,
    });
    expect(seen).toStrictEqual([EXAMPLE_PR_FORM.title]);
    expect(preview).toStrictEqual({
      kind: "refused",
      reason: "the resulting body fails the PR gate: a FIXTURE finding the scan raised",
    });
  });

  it("refuses a problem seen after the day the update is written, before anything renders", () => {
    const draft: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      problemSeen: { by: "agent", kind: "seen", on: "2026-10-07", what: "an exported report was one row short" },
    };
    const preview = previewedUpdate({
      chosen: chosen({ draft, trailing: "" }),
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      titlePolicy: POLICY,
      draft,
      live: LIVE,
      today: TODAY,
    });
    expect(preview).toStrictEqual({
      kind: "refused",
      reason:
        "the problem is marked seen on 2026-10-07, after today (2026-10-06). A problem seen today is seen today, " +
        "never later",
    });
  });

  it("puts a pasted screenshot back after the block it followed, inside the body the PR gate checks", () => {
    const preview = previewedUpdate({
      chosen: chosen({
        draft: EXAMPLE_PR_FORM,
        pasted: [{ after: "problem-proof", occurrence: 1, raw: PASTE }],
        trailing: "",
      }),
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      titlePolicy: POLICY,
      draft: EXAMPLE_PR_FORM,
      live: LIVE,
      today: TODAY,
    });
    expect(preview.kind).toBe("ready");
    const ready = preview as Extract<typeof preview, { kind: "ready" }>;
    expect(ready.body).toBe(ready.rendered.body);
    expect(ready.body).toContain(`${PROBLEM}\n\n${PASTE}\n\n`);
    expect(ready.body.split(PASTE).length).toBe(2);
  });

  it("does not scan the trailing region, which is already on GitHub", () => {
    const preview = previewedUpdate({
      chosen: chosen({ draft: EXAMPLE_PR_FORM, trailing: "\n\nhunter2-legacy-passphrase" }),
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      titlePolicy: POLICY,
      draft: EXAMPLE_PR_FORM,
      live: LIVE,
      today: TODAY,
    });
    expect(preview.kind).toBe("ready");
  });
});
