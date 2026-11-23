/**
 * `renderAndCheck` runs the same two checks CI's `pr-format` step runs: the body's shape AND the secret scan over
 * the title and body. Before this, a dry run printed ACCEPTS over a body carrying a credential, the live write
 * sent it to GitHub, and only CI's `pr-format` refused it — a lap spent after the secret was already published.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  noPublicationFindings,
  prPublicationScan,
  type RenderedBody,
  renderAndCheck,
  stampToday,
  writeGates,
} from "../../../../../cli/commands/github/prRenderGate.js";
import { parsePrivateTerms } from "../../../../../hygiene/privateTerms.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { TitleShapePolicy } from "../../../../../outbound/github/titleShape.js";
import type { PrForm, PrFormDraft } from "../../../../../outbound/github/types.js";
import { ProfileReadErrors } from "../../../../../profileStore.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";

/** A literal secret no pattern in `scan.ts` can express — the shape the private denylist exists for. */
const DENYLIST = ["hunter2-legacy-passphrase"];

/** Built at runtime so this file does not itself carry a credential shape the repository gate would refuse. */
const TOKEN = `ghp_${"a".repeat(30)}`;

/** This build's own repository, so a title aimed at it is judged by the code's own shape. */
const SELF_POLICY = ok<TitleShapePolicy>({ repositoryShapes: {}, selfRepository: "acme/slopweaver" });

/** Stamp a draft on a fixed day, so nothing here reads the wall clock. */
function stamped({ draft }: { draft: PrFormDraft }): PrForm {
  return unwrap(stampToday({ draft, now: () => new Date("2026-10-06T00:00:00.000Z") }));
}

describe("renderAndCheck runs CI's pr-format secret scan", () => {
  it("accepts the example form, which carries no secret", () => {
    const rendered = renderAndCheck({
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: stamped({ draft: EXAMPLE_PR_FORM }),
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.errors).toStrictEqual([]);
    expect(rendered.ok).toBe(true);
  });

  it("refuses a body carrying a credential shape, without echoing it", () => {
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text: `rotated ${TOKEN} today` }] };
    const rendered = renderAndCheck({
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: stamped({ draft }),
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.body).toContain(TOKEN);
    expect(rendered.ok).toBe(false);
    // The token also reads as a snake_case "variable" in plain text, and that rule's quote is withheld with it.
    expect(rendered.errors).toHaveLength(2);
    expect(rendered.errors[0]).toMatch(/^explainer: CODE_UNFORMATTED: this rule quotes the text it found, and the /);
    expect(rendered.errors[1]).toMatch(
      /^PR body contains a github-oauth-token shape at line \d+ — remove it \(the matched text is redacted from this log\)\.$/,
    );
    expect(rendered.errors.filter((line) => line.includes(TOKEN))).toStrictEqual([]);
  });

  it("refuses a title carrying a denylisted term", () => {
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, title: "rotate hunter2-legacy-passphrase" };
    const rendered = renderAndCheck({
      denylist: DENYLIST,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: stamped({ draft }),
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.errors).toStrictEqual([
      "PR title contains a denylisted term at line 1 — remove it (the matched text is redacted from this log).",
    ]);
    expect(rendered.ok).toBe(false);
  });

  it("lets the same title through when no denylist is configured, as CI does", () => {
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, title: "rotate hunter2-legacy-passphrase" };
    const rendered = renderAndCheck({
      denylist: [],
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: stamped({ draft }),
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.errors).toStrictEqual([]);
  });

  it("refuses with the publication scan's own lines, run on the exact title and body it renders", () => {
    const seen: { title: string; body: string }[] = [];
    const rendered = renderAndCheck({
      denylist: [],
      form: stamped({ draft: EXAMPLE_PR_FORM }),
      installationIdentifiers: undefined,
      liveTitle: undefined,
      publicationScan: (input) => {
        seen.push({ body: input.body, title: input.title });
        return ["a finding the scan names"];
      },
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.errors).toStrictEqual(["a finding the scan names"]);
    expect(rendered.ok).toBe(false);
    expect(seen).toStrictEqual([{ body: rendered.body, title: EXAMPLE_PR_FORM.title }]);
  });
});

describe("the production publication scan over a rendered C3 body", () => {
  /** Render and check a draft with the scan every real write runs. */
  function checked({ draft }: { draft: PrFormDraft }): ReturnType<typeof renderAndCheck> {
    return renderAndCheck({
      denylist: [],
      form: stamped({ draft }),
      installationIdentifiers: undefined,
      liveTitle: undefined,
      publicationScan: prPublicationScan({ privateTerms: [] }),
      titlePolicy: SELF_POLICY,
    });
  }

  it("passes the example form, so nothing the renderer itself writes trips it", () => {
    expect(checked({ draft: EXAMPLE_PR_FORM }).errors).toStrictEqual([]);
  });

  it("refuses first person in the explainer, naming the description", () => {
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text: "We fixed the parser." }] };
    const rendered = checked({ draft });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors).toHaveLength(1);
    expect(rendered.errors[0]).toContain("PR description line");
    expect(rendered.errors[0]).toContain('"We" is first person');
  });

  it("refuses first person in the title, naming the title", () => {
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, title: "fix(parser): stop my parser refusing" };
    const rendered = checked({ draft });
    expect(rendered.errors).toHaveLength(1);
    expect(rendered.errors[0]).toContain('PR title line 1: "my" is first person');
  });

  it("refuses a transcript pointer and the host named by its make", () => {
    const draft: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      explainer: [{ kind: "text", text: "Seen on this Mac, transcript:a0000057-0000-4000-8000-000000000063." }],
    };
    const rendered = checked({ draft });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors.some((line) => line.includes('"this Mac" names the host'))).toBe(true);
    expect(rendered.errors.some((line) => line.includes("redacted here"))).toBe(true);
  });

  it("refuses a private term in the body by class, which CI's own scan cannot see", () => {
    const privateTerms = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
    );
    const draft: PrFormDraft = { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text: "Asked by Quillfeather." }] };
    const rendered = renderAndCheck({
      denylist: [],
      form: stamped({ draft }),
      installationIdentifiers: undefined,
      liveTitle: undefined,
      publicationScan: prPublicationScan({ privateTerms }),
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors).toHaveLength(1);
    expect(rendered.errors[0]).toContain("a private person term (redacted here)");
    expect(rendered.errors[0]!.toLowerCase().includes("quillfeather")).toBe(false);
  });

  it("forgives a private term inside the pull request's own repository address, and only there", () => {
    const privateTerms = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nowner-handle\ti\tquillfeather\tsynthetic\n" }),
    );
    const target = { ...EXAMPLE_PR_FORM.target, owner: "quillfeather", repo: "widgets" };
    const check = ({ text }: { text: string }): RenderedBody =>
      renderAndCheck({
        denylist: [],
        form: stamped({ draft: { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text }], target } }),
        installationIdentifiers: undefined,
        liveTitle: undefined,
        publicationScan: prPublicationScan({ privateTerms }),
        titlePolicy: SELF_POLICY,
      });
    expect(check({ text: "Follows quillfeather/widgets#7." }).errors).toEqual([]);
    expect(check({ text: "Follows quillfeather/notes#7." }).errors).toHaveLength(1);
  });
});

describe("writeGates reads the private terms fail-closed", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const dir of homes.splice(0)) rmSync(dir, { force: true, recursive: true });
  });
  const freshHome = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "sw-write-gates-"));
    homes.push(dir);
    return dir;
  };

  it("refuses every title and body with the absent file's refusal, and scans once the file says none", () => {
    const home = freshHome();
    const absent = writeGates({ home }).publicationScan({
      body: "clean",
      ownRepository: "acme/widgets",
      title: "fix: clean",
    });
    expect(absent).toHaveLength(1);
    expect(absent[0]).toContain(
      `hygiene: the private terms file ${join(home, "hygiene", "private-terms.tsv")} does not exist`,
    );
    writePrivateTerms({ home });
    expect(
      writeGates({ home }).publicationScan({ body: "clean", ownRepository: "acme/widgets", title: "fix: clean" }),
    ).toStrictEqual([]);
  });
});

describe("renderAndCheck holds a title being set to the repository's shape", () => {
  const SELF = { ...EXAMPLE_PR_FORM.target, owner: "acme", repo: "slopweaver" };
  const OLD_TITLE = "[ABC-840] Two plain badges";

  /** The example form aimed at this build's own repository under a title. */
  function onSelf({ title }: { title: string }): PrForm {
    return stamped({ draft: { ...EXAMPLE_PR_FORM, target: SELF, title } });
  }

  it("refuses a create whose title is not in the shape, naming the shape", () => {
    const rendered = renderAndCheck({
      denylist: [],
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: onSelf({ title: OLD_TITLE }),
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors.join(" ")).toContain("kind: outcome or kind(area): outcome");
  });

  it("withholds the title refusal when the title it quotes carries a credential shape", () => {
    const rendered = renderAndCheck({
      denylist: [],
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: onSelf({ title: `Rotate ${TOKEN}` }),
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors.filter((line) => line.includes(TOKEN))).toStrictEqual([]);
    expect(rendered.errors).toContain(
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the " +
        "credential the secret scan names, and the refusal prints in full",
    );
  });

  it("withholds the renderer's own refusal when the malformed day it quotes carries a credential shape", () => {
    const form: PrForm = {
      ...onSelf({ title: "fix(widgets): refuse an open store" }),
      problemSeen: { by: "agent", kind: "seen", on: TOKEN, what: "seen" },
    };
    const rendered = renderAndCheck({
      denylist: [],
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form,
      liveTitle: undefined,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors.filter((line) => line.includes(TOKEN))).toStrictEqual([]);
    expect(rendered.errors).toStrictEqual([
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the " +
        "credential the secret scan names, and the refusal prints in full",
    ]);
  });

  it("lets a re-render through that sends the live title unchanged, however old its shape", () => {
    const rendered = renderAndCheck({
      denylist: [],
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      form: onSelf({ title: OLD_TITLE }),
      liveTitle: OLD_TITLE,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.errors).toStrictEqual([]);
  });

  it("refuses an update that changes the title into another wrong shape", () => {
    const form = onSelf({ title: "Two plain badges" });
    const rendered = renderAndCheck({
      denylist: [],
      form,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      liveTitle: OLD_TITLE,
      titlePolicy: SELF_POLICY,
    });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors.join(" ")).toContain("kind: outcome or kind(area): outcome");
  });

  it("accepts an update that changes the title into the shape", () => {
    const form = onSelf({ title: "feat(pr-body): two plain badges" });
    expect(
      renderAndCheck({
        denylist: [],
        form,
        installationIdentifiers: undefined,
        publicationScan: noPublicationFindings,
        liveTitle: OLD_TITLE,
        titlePolicy: SELF_POLICY,
      }).errors,
    ).toStrictEqual([]);
  });

  it("refuses the write with the policy's own refusal when the policy could not be read", () => {
    const form = onSelf({ title: "feat(pr-body): two plain badges" });
    const titlePolicy = err(ProfileReadErrors.unreadable({ detail: "not JSON: x", path: "/x/profile.json" }));
    const rendered = renderAndCheck({
      denylist: [],
      form,
      installationIdentifiers: undefined,
      publicationScan: noPublicationFindings,
      liveTitle: undefined,
      titlePolicy,
    });
    expect(rendered.ok).toBe(false);
    expect(rendered.errors).toStrictEqual([
      "PROFILE_UNREADABLE: the profile at /x/profile.json is there but cannot be trusted (not JSON: x) — fix it, " +
        "or move it aside to run as an install that has configured nothing",
    ]);
  });
});
