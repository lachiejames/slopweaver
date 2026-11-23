/**
 * The `proposal intake`, `publish` and `teaser` COMMANDS. The fixtures are `./publishRunFixture.ts`.
 *
 * `publish` carries two independent refusals and both are asserted here, because either one silently
 * failing open is the difference between a gate and a decoration: a document with a blocking finding, and an
 * intake with a question only its stakeholder can settle. Neither reaches the destination at all.
 *
 * Every edge is a plain injected function. No mocks.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { PROPOSAL_FORM_EXAMPLE } from "../../../../../cli/commands/proposal/formExample.js";
import { runProposalIntake } from "../../../../../cli/commands/proposal/intakeRun.js";
import { runProposalPublish, runProposalTeaser } from "../../../../../cli/commands/proposal/publishRun.js";
import type { ProposalPublishDeps } from "../../../../../cli/commands/proposal/publishRunShared.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { proposalDestinationPath } from "../../../../../outbound/proposal/destinationStore.js";
import { ProposalIntakeErrors } from "../../../../../outbound/proposal/errors.js";
import { deriveIntake } from "../../../../../outbound/proposal/intake.js";
import { intakePath, loadIntake, saveIntake } from "../../../../../outbound/proposal/intakeStore.js";
import { listRegisterSlugs, loadRegisterEntry } from "../../../../../outbound/proposal/register/store.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import {
  ADDRESS,
  answeredIntake,
  argv,
  bareHome,
  GOLDEN,
  harness,
  NOW,
  PAGE,
  PARENT,
  takeMintedHomes,
  tempHome,
  URL,
} from "./publishRunFixture.js";

afterEach(() => {
  for (const dir of takeMintedHomes()) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("runProposalIntake", () => {
  it("seeds the questions and reports them as open, which is a status rather than a fault", async () => {
    const h = harness();
    const home = tempHome();
    const code = await runProposalIntake({
      argv: argv({ rest: ["--brief", "a brief", "--id", "a-brief", "--home", home], verb: "intake" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(loadIntake({ home, id: "a-brief" })).questions.length).toBe(6);
    expect(h.out[0]).toBe("intake a-brief  (intake)");
  });

  it("refuses without a brief", async () => {
    const h = harness();
    expect(await runProposalIntake({ argv: argv({ rest: [], verb: "intake" }), deps: h.deps })).toBe(EXIT_USAGE);
  });

  it("refuses an id that would escape the state home", async () => {
    const h = harness();
    const code = await runProposalIntake({
      argv: argv({ rest: ["--brief", "b", "--id", "../../x", "--home", tempHome()], verb: "intake" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("keeps the answers when the SAME command is run again, which once wiped six of them", async () => {
    const home = tempHome();
    const rest = ["--brief", "a brief", "--id", "a-brief", "--home", home];
    await runProposalIntake({ argv: argv({ rest, verb: "intake" }), deps: harness().deps });
    const seeded = unwrap(loadIntake({ home, id: "a-brief" }));
    saveIntake({
      home,
      intake: {
        ...seeded,
        questions: seeded.questions.map((question, index) =>
          index === 0 ? { ...question, answer: "the team lead decides" } : question,
        ),
      },
    });
    const h = harness();
    const code = await runProposalIntake({ argv: argv({ rest, verb: "intake" }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const stored = unwrap(loadIntake({ home, id: "a-brief" }));
    expect(stored.questions.find((question) => question.key === "audience")!.answer).toBe("the team lead decides");
    expect(h.err.join("\n")).toContain(
      "kept 1 answer(s), added 0 new question(s), carried 0 stored question(s) no standing question claimed",
    );
    expect(h.err.join("\n")).toContain("5 blocking question(s) still open");
  });

  it("updates the brief on a re-seed and says so, without touching an answer", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    const h = harness();
    const code = await runProposalIntake({
      argv: argv({ rest: ["--brief", "a sharper brief", "--id", "a-brief", "--home", home], verb: "intake" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const stored = unwrap(loadIntake({ home, id: "a-brief" }));
    expect(stored.brief).toBe("a sharper brief");
    expect(stored.questions.every((question) => question.answer === "yes")).toBe(true);
    expect(h.err.join("\n")).toContain("brief updated.");
    expect(h.out[2]).toBe("  [answered] audience: yes");
  });

  it("refuses to re-seed over a record it cannot read, and leaves its bytes exactly as they were", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    const path = intakePath({ home, id: "a-brief" });
    const corrupt = `{"brief": "a brief", "id": "a-brief"`;
    writeFileSync(path, corrupt);
    const h = harness();
    const code = await runProposalIntake({
      argv: argv({ rest: ["--brief", "a brief", "--id", "a-brief", "--home", home], verb: "intake" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(corrupt);
    expect(h.err.join("\n")).toContain("refusing to re-seed over it");
    expect(h.out).toEqual([]);
  });

  it("says nothing about a merge on a first seed", async () => {
    const h = harness();
    const home = tempHome();
    await runProposalIntake({
      argv: argv({ rest: ["--brief", "a brief", "--id", "a-brief", "--home", home], verb: "intake" }),
      deps: h.deps,
    });
    expect(h.err.join("\n")).not.toContain("merged into the existing intake");
    expect(h.err.join("\n")).toContain("6 blocking question(s) still open");
  });
});

describe("runProposalPublish", () => {
  it("refuses a document with a blocking finding, and never reaches the page", async () => {
    const h = harness({ text: `${GOLDEN}\nSee https://example.test/raw for the workings.\n` });
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--home", tempHome()], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.published()).toBe(undefined);
    expect(h.err.join("\n")).toContain("refusing to publish");
  });

  it("refuses a CORRUPT profile.json with the error code, and never reaches the page", async () => {
    const home = tempHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const base = harness();
    const deps: ProposalPublishDeps = { ...base.deps, voiceRules: ({ home: at }) => readExactVoiceRules({ home: at }) };
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--title", "T", "--home", home], verb: "publish" }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(base.published()).toBe(undefined);
    expect(base.err).toHaveLength(1);
    expect(base.err[0]).toContain(`the profile at ${join(home, "profile.json")} is there but cannot be trusted`);
    expect(base.err[0]).toContain("nothing was published.");
  });

  it("refuses while the named intake still has a blocking question open", async () => {
    const home = tempHome();
    saveIntake({ home, intake: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }) });
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.published()).toBe(undefined);
    expect(h.err.join("\n")).toContain("6 blocking question(s) open");
  });

  it("refuses a named intake whose record is malformed as a usage problem, not as a 'not yet'", async () => {
    // The exit code once hung on whether the message happened to start with "intake ", which sent a record
    // with no questions array down the unanswered-question path. It is decided by which step refused now.
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    writeFileSync(intakePath({ home, id: "a-brief" }), JSON.stringify({ brief: "a brief", id: "a-brief" }));
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.published()).toBe(undefined);
    expect(h.err[0]).toBe(ProposalIntakeErrors.noQuestions({ id: "a-brief" }).message);
  });

  it("refuses when this install has set no destination, naming the command that sets one", async () => {
    const home = bareHome();
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.published()).toBe(undefined);
    expect(h.err).toEqual([
      `this install has no proposal destination yet (looked at ${proposalDestinationPath({ home })}). Set one ` +
        "with: slopweaver proposal destination set notion-page --parent <page-id-or-url> | local-page " +
        "| linear-document --target-kind <project|initiative|issue|team> --target-id <id>",
    ]);
  });

  it("refuses a destination file it cannot trust as an error, never as unset, and never reaches the page", async () => {
    const home = bareHome();
    writeFileAtomic({
      contents: '{"kind":"notion-page","parnet":"x","schemaVersion":1}',
      path: proposalDestinationPath({ home }),
    });
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.published()).toBe(undefined);
    expect(h.err[0]).toContain(`${proposalDestinationPath({ home })} is not a proposal destination this build accepts`);
  });

  it("refuses the retired --parent flag, pointing at where a destination now lives", async () => {
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--parent", PARENT, "--home", tempHome()], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.published()).toBe(undefined);
    expect(h.err[0]).toContain("--parent is no longer a publish flag");
    expect(h.err[0]).toContain("slopweaver proposal destination set notion-page --parent <page-id-or-url>");
  });

  it("creates under the stored destination when the intake has never published", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.published()!.parent).toBe(PARENT);
    expect(h.published()!.pageId).toBe(undefined);
  });

  it("records the page on the intake, so the NEXT publish keeps this URL", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: harness().deps,
    });
    const stored = unwrap(loadIntake({ home, id: "a-brief" }));
    expect(stored.address).toEqual(ADDRESS);
    expect(stored.status).toBe("published");
  });

  it("updates the recorded page on a re-publish rather than creating under the destination", async () => {
    const home = tempHome();
    saveIntake({
      home,
      intake: { ...answeredIntake({ id: "a-brief" }), address: ADDRESS, status: "published" },
    });
    const h = harness();
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(h.published()!.pageId).toBe(PAGE);
    expect(h.published()!.parent).toBe(undefined);
  });

  it("does not touch the intake on a dry run", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    await runProposalPublish({
      argv: argv({
        rest: ["draft.md", "--intake", "a-brief", "--dry-run", "--home", home],
        verb: "publish",
      }),
      deps: harness().deps,
    });
    expect(unwrap(loadIntake({ home, id: "a-brief" })).address).toBe(undefined);
  });

  it("sends the file's bytes verbatim, since those are what the lint judged", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    const h = harness();
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(h.published()!.markdown).toBe(GOLDEN);
  });
});

describe("runProposalPublish — a recorded address the destination cannot reconcile", () => {
  it("refuses a re-publish recorded on another provider, and writes nothing", async () => {
    const home = tempHome();
    const linear = { id: "doc-1", provider: "linear" as const };
    saveIntake({ home, intake: { ...answeredIntake({ id: "a-brief" }), address: linear, status: "published" } });
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.published()).toBe(undefined);
    expect(h.err.join("\n")).toContain("published to linear, but the install now publishes to notion");
  });

  it("refuses a re-publish from a legacy record holding only a page URL, which still teasers", async () => {
    const home = tempHome();
    const legacy = JSON.stringify({ ...answeredIntake({ id: "a-brief" }), pageUrl: URL });
    writeFileAtomic({ contents: legacy, path: intakePath({ home, id: "a-brief" }) });
    const h = harness();
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.published()).toBe(undefined);
    expect(h.err.join("\n")).toContain("records only the URL of the page it published");
    const teaser = harness({ text: JSON.stringify(PROPOSAL_FORM_EXAMPLE) });
    await runProposalTeaser({
      argv: argv({ rest: ["--form", "-", "--intake", "a-brief", "--home", home], verb: "teaser" }),
      deps: teaser.deps,
    });
    const parsed = JSON.parse(teaser.out.join("\n")) as { messages: readonly { runs: readonly { url?: string }[] }[] };
    expect(parsed.messages[0]!.runs[0]!.url).toBe(URL);
  });
});

describe("runProposalTeaser", () => {
  it("renders the as-me form from the intake's recorded page URL", async () => {
    const home = tempHome();
    saveIntake({
      home,
      intake: { ...answeredIntake({ id: "a-brief" }), address: ADDRESS, status: "published" },
    });
    const h = harness({ text: JSON.stringify(PROPOSAL_FORM_EXAMPLE) });
    const code = await runProposalTeaser({
      argv: argv({ rest: ["--form", "-", "--intake", "a-brief", "--home", home], verb: "teaser" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const parsed = JSON.parse(h.out.join("\n")) as {
      kind: string;
      messages: readonly { runs: readonly { url?: string }[] }[];
    };
    expect(parsed.kind).toBe("drip");
    expect(parsed.messages[0]!.runs[0]!.url).toBe(URL);
  });

  it("leads with --page over the URL the named intake recorded", async () => {
    const home = tempHome();
    saveIntake({
      home,
      intake: { ...answeredIntake({ id: "a-brief" }), address: ADDRESS, status: "published" },
    });
    const given = "https://app.notion.com/p/a-given-page";
    const h = harness({ text: JSON.stringify(PROPOSAL_FORM_EXAMPLE) });
    const code = await runProposalTeaser({
      argv: argv({ rest: ["--form", "-", "--intake", "a-brief", "--page", given, "--home", home], verb: "teaser" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const parsed = JSON.parse(h.out.join("\n")) as { messages: readonly { runs: readonly { url?: string }[] }[] };
    expect(parsed.messages[0]!.runs[0]!.url).toBe(given);
  });

  it("says plainly that it rendered a form rather than posting", async () => {
    const h = harness({ text: JSON.stringify(PROPOSAL_FORM_EXAMPLE) });
    await runProposalTeaser({
      argv: argv({ rest: ["--form", "-", "--page", URL], verb: "teaser" }),
      deps: h.deps,
    });
    expect(h.err.join("\n")).toContain("this is a FORM, not a post");
  });

  it("refuses with neither a page nor an intake, because a teaser leads with the link", async () => {
    const h = harness({ text: JSON.stringify(PROPOSAL_FORM_EXAMPLE) });
    const code = await runProposalTeaser({ argv: argv({ rest: ["--form", "-"], verb: "teaser" }), deps: h.deps });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses when the named intake has not published yet", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    const h = harness({ text: JSON.stringify(PROPOSAL_FORM_EXAMPLE) });
    const code = await runProposalTeaser({
      argv: argv({ rest: ["--form", "-", "--intake", "a-brief", "--home", home], verb: "teaser" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("has not published a page yet");
  });
});

describe("runProposalPublish — image placeholders", () => {
  it("resolves the draft's `file:` placeholders against the DRAFT'S OWN directory", async () => {
    const h = harness();
    await runProposalPublish({
      argv: argv({
        rest: ["/repo/drafts/a-draft.md", "--home", tempHome()],
        verb: "publish",
      }),
      deps: h.deps,
    });
    // The body reaches `notion page` on stdin, so nothing downstream could work this out for itself.
    expect(h.published()!.mediaBase).toBe("/repo/drafts");
  });

  it("records the page even when the publish exits non-zero, because a page that exists must not be forgotten", async () => {
    const h = harness({ code: EXIT_EXPECTED_EMPTY });
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "an-intake" }) });
    const code = await runProposalPublish({
      argv: argv({
        rest: ["draft.md", "--intake", "an-intake", "--home", home],
        verb: "publish",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(loadIntake({ home, id: "an-intake" })).address).toEqual(ADDRESS);
    // Same reasoning, one layer out: the register is what a reader lists, so a page it forgot is a page
    // nothing points at.
    expect(unwrap(loadRegisterEntry({ home, slug: "an-intake" }))!.address.id).toBe(PAGE);
  });
});

describe("runProposalPublish — register integration", () => {
  it("registers a new entry, keyed by intake id, on a first successful publish", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    await runProposalPublish({
      argv: argv({
        rest: ["draft.md", "--intake", "a-brief", "--title", "A proposal", "--home", home],
        verb: "publish",
      }),
      deps: harness().deps,
    });
    const entry = unwrap(loadRegisterEntry({ home, slug: "a-brief" }))!;
    expect(entry.title).toBe("A proposal");
    expect(entry.address.id).toBe(PAGE);
    expect(entry.address.url).toBe(URL);
    expect(entry.intakeId).toBe("a-brief");
    expect(entry.status).toBe("strawman");
    expect(entry.source).toBe("publish");
  });

  it("falls back to the intake's brief as the title when --title is omitted", async () => {
    const home = tempHome();
    const intake = answeredIntake({ id: "a-brief" });
    saveIntake({ home, intake });
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--home", home], verb: "publish" }),
      deps: harness().deps,
    });
    expect(unwrap(loadRegisterEntry({ home, slug: "a-brief" }))!.title).toBe(intake.brief);
  });

  it("appends a destination-linked event rather than a second entry on a re-publish", async () => {
    const home = tempHome();
    saveIntake({
      home,
      intake: { ...answeredIntake({ id: "a-brief" }), address: ADDRESS, status: "published" },
    });
    await runProposalPublish({
      argv: argv({
        rest: ["draft.md", "--intake", "a-brief", "--title", "A renamed proposal", "--home", home],
        verb: "publish",
      }),
      deps: harness().deps,
    });
    const entry = unwrap(loadRegisterEntry({ home, slug: "a-brief" }))!;
    expect(entry.title).toBe("A renamed proposal");
    expect(entry.source).toBe("publish");
  });

  it("registers a proposal published with no intake at all, deriving its slug from title and address", async () => {
    const home = tempHome();
    const code = await runProposalPublish({
      argv: argv({
        rest: ["draft.md", "--title", "A standalone proposal", "--home", home],
        verb: "publish",
      }),
      deps: harness().deps,
    });
    expect(code).toBe(EXIT_OK);
    const entry = unwrap(loadRegisterEntry({ home, slug: `a-standalone-proposal-${PAGE.replaceAll("-", "")}` }))!;
    expect(entry.title).toBe("A standalone proposal");
    expect(entry.intakeId).toBe(undefined);
  });

  it("titles an entry published with neither --title nor an intake as an untitled proposal", async () => {
    const home = tempHome();
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--home", home], verb: "publish" }),
      deps: harness().deps,
    });
    const slugs = listRegisterSlugs({ home });
    expect(slugs).toHaveLength(1);
    expect(unwrap(loadRegisterEntry({ home, slug: slugs[0]! }))!.title).toBe("(untitled proposal)");
  });

  it("does not touch the register on a dry run", async () => {
    const home = tempHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    await runProposalPublish({
      argv: argv({
        rest: ["draft.md", "--intake", "a-brief", "--dry-run", "--home", home],
        verb: "publish",
      }),
      deps: harness().deps,
    });
    expect(unwrap(loadRegisterEntry({ home, slug: "a-brief" }))).toBe(undefined);
  });
});
