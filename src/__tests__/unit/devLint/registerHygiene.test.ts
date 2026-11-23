import { describe, expect, it } from "vitest";
import { checkRegister, frontMatterLineOf } from "../../../devLint/registerHygiene.js";
import type { HandoverDoc } from "../../../handover/doc.js";

/**
 * A sound doc, overridden per case. Every field is stated rather than defaulted away, because the gate's whole
 * subject is which fields are missing — a factory that quietly filled one in would test the factory.
 */
const doc = (over: Partial<HandoverDoc> = {}): HandoverDoc => ({
  anchor: undefined,
  askedIso: undefined,
  kind: "doc",
  priority: undefined,
  settlement: undefined,
  settlementReason: undefined,
  settlementWitness: undefined,
  origin: undefined,
  observedBy: undefined,
  registeredBy: undefined,
  registeredRun: undefined,
  evidence: [],
  ruling: undefined,
  rulingAnchor: undefined,
  hisWords: { kind: "absent" },
  hisWordsSteers: [],
  artifact: "https://claude.ai/code/artifact/aaaa",
  baseBranch: undefined,
  blockedBy: [],
  branch: undefined,
  doneWhen: [],
  notDoneReason: undefined,
  outputs: [],
  pausedOn: undefined,
  pausedSince: undefined,
  risk: undefined,
  blastRadius: undefined,
  stillReal: undefined,
  stillRealIso: undefined,
  path: "/board/sound.md",
  probeWaiver: undefined,
  lean: undefined,
  examples: [],
  exampleGap: undefined,
  options: [],
  problem: undefined,
  problems: [],
  repo: "/repo",
  role: undefined,
  slug: "sound",
  status: "ready",
  statusSummary: undefined,
  supervisorState: undefined,
  summary: "a doc the board can place",
  ...over,
});

const NOTHING_LANDED: ReadonlySet<string> = new Set<string>();

describe("checkRegister", () => {
  it("reports nothing for a register whose docs are all placeable", () => {
    expect(checkRegister({ docs: [doc()], landedPaths: NOTHING_LANDED })).toEqual([]);
  });

  it("reports nothing for an empty register", () => {
    expect(checkRegister({ docs: [], landedPaths: NOTHING_LANDED })).toEqual([]);
  });

  it("names the doc a finding belongs to by slug AND path", () => {
    const findings = checkRegister({
      docs: [doc({ artifact: undefined, path: "/board/orphan.md", slug: "orphan" })],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.slug).toBe("orphan");
    expect(findings[0]!.path).toBe("/board/orphan.md");
  });

  it("fails a status the parser does not accept, which reaches it as `unknown`", () => {
    const findings = checkRegister({ docs: [doc({ status: "unknown" })], landedPaths: NOTHING_LANDED });
    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("declares no usable `status:`");
  });

  it("fails a doc with no artifact link", () => {
    const findings = checkRegister({ docs: [doc({ artifact: undefined })], landedPaths: NOTHING_LANDED });
    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("has no `artifact:` link");
  });

  it("fails a blockedBy naming a slug no doc on the register claims", () => {
    const findings = checkRegister({
      docs: [doc({ blockedBy: ["ghost"] })],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("blockedBy names `ghost`");
  });

  it("accepts a blockedBy naming a slug another doc on the register claims", () => {
    const findings = checkRegister({
      docs: [doc({ blockedBy: ["upstream"] }), doc({ path: "/board/upstream.md", slug: "upstream" })],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings).toEqual([]);
  });

  it("resolves a dependency against the WHOLE register, not the doc declaring it", () => {
    // The register-wide reading is the thing the single-doc `handover check` verb cannot do, so it is asserted
    // by order too: the dependency is declared before the doc that satisfies it appears.
    const upstream = doc({ path: "/board/upstream.md", slug: "upstream", status: "done" });
    expect(checkRegister({ docs: [doc({ blockedBy: ["upstream"] }), upstream], landedPaths: NOTHING_LANDED })).toEqual(
      [],
    );
  });

  it("fails a doc whose every probe passes while it still declares `ready`", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped" })],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.slug).toBe("shipped");
    expect(findings[0]!.message).toContain("every declared probe passes but it still says `status: ready`");
  });

  it("accepts a doc whose every probe passes and which declares `done`", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped", status: "done" })],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings).toEqual([]);
  });

  it("keys the looks-shipped verdict by PATH, so a doc that did not land is untouched", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/other.md", slug: "other" })],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings).toEqual([]);
  });

  it("fails an in-progress doc that looks shipped — only `done` settles the bookkeeping", () => {
    const findings = checkRegister({
      docs: [doc({ status: "in-progress" })],
      landedPaths: new Set(["/board/sound.md"]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("still says `status: in-progress`");
  });

  it("carries a front-matter parse problem through as a finding", () => {
    const findings = checkRegister({
      docs: [doc({ problems: ['front-matter declares "blockedBy" more than once — which one is meant?'] })],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain('declares "blockedBy" more than once');
  });

  it("reports every defect on one doc rather than stopping at the first", () => {
    const findings = checkRegister({
      docs: [doc({ artifact: undefined, blockedBy: ["ghost"], status: "unknown" })],
      landedPaths: new Set(["/board/sound.md"]),
    });
    expect(findings.map((finding) => finding.slug)).toEqual(["sound", "sound", "sound", "sound"]);
    expect(findings.length).toBe(4);
  });

  it("reports findings grouped by doc, in board order", () => {
    const findings = checkRegister({
      docs: [
        doc({ artifact: undefined, path: "/board/a.md", slug: "a" }),
        doc({ path: "/board/b.md", slug: "b" }),
        doc({ artifact: undefined, path: "/board/c.md", slug: "c" }),
      ],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings.map((finding) => finding.slug)).toEqual(["a", "c"]);
  });
});

describe("frontMatterLineOf — the report has to point at the exact line", () => {
  const DOC = ["---", "slug: a-doc", "summary: does a thing", "status: ready", "---", "", "# Body"].join("\n");

  it("finds the 1-indexed line of a declared key and returns it verbatim", () => {
    expect(frontMatterLineOf({ field: "status", text: DOC })).toEqual({ current: "status: ready", line: 4 });
  });

  it("returns undefined for a key the front matter does not declare", () => {
    expect(frontMatterLineOf({ field: "artifact", text: DOC })).toBeUndefined();
  });

  it("stops at the closing fence, so a `status:` in the PROSE is never named as the line to edit", () => {
    const text = ["---", "slug: a-doc", "---", "", "Set `status:` on it when done.", "status: ready"].join("\n");
    expect(frontMatterLineOf({ field: "status", text })).toBeUndefined();
  });

  it("returns undefined for a doc with no front matter at all", () => {
    expect(frontMatterLineOf({ field: "status", text: "# Just a body\n\nstatus: ready\n" })).toBeUndefined();
  });

  it("reads CRLF the same as LF, since a doc edited on another machine is still the same doc", () => {
    expect(frontMatterLineOf({ field: "status", text: DOC.replace(/\n/g, "\r\n") })).toEqual({
      current: "status: ready",
      line: 4,
    });
  });
});

describe("checkRegister — the fix each finding points at", () => {
  it("names the status field and the exact value a looks-shipped doc should carry", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped" })],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings[0]!.field).toBe("status");
    expect(findings[0]!.fix).toBe("done");
  });

  it("names the artifact field for a doc with no artifact, and offers no single right value", () => {
    const findings = checkRegister({ docs: [doc({ artifact: undefined })], landedPaths: NOTHING_LANDED });
    expect(findings[0]!.field).toBe("artifact");
    expect(findings[0]!.fix).toBeUndefined();
  });

  it("leaves the field undefined for a parse defect, which is not tied to one key", () => {
    const findings = checkRegister({
      docs: [doc({ problems: ['front-matter declares "blockedBy" more than once'] })],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings[0]!.field).toBeUndefined();
  });
});

describe("checkRegister — blocking, by default, on every finding", () => {
  it("marks a front-matter finding blocking when the caller supplies no non-blocking paths at all", () => {
    const findings = checkRegister({
      docs: [doc({ artifact: undefined, path: "/board/same-repo.md" })],
      landedPaths: NOTHING_LANDED,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.blocking).toBe(true);
  });

  it("reports, but does not block, a missing-artifact finding on a doc whose repo is not the one pushing", () => {
    // A doc with `repo:` pointing at another repository and no `artifact:` — the exact scenario a supervisor-
    // written doc caused, blocking an unrelated push in a different tree. The doc must still be REPORTED (a
    // real defect never goes silent), just not counted toward the exit code.
    const findings = checkRegister({
      docs: [doc({ artifact: undefined, path: "/board/other-repo.md" })],
      landedPaths: NOTHING_LANDED,
      nonBlockingPaths: new Set(["/board/other-repo.md"]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.field).toBe("artifact");
    expect(findings[0]!.blocking).toBe(false);
  });

  it("reports, but does not block, a malformed doneWhen: (wrong probe shape) on a doc from another repo", () => {
    // The `kind:/path:/contains:` shape a hand-authored doc once used live — a real `problems` entry,
    // same as a duplicate flat key, and scoped by the identical rule: still printed, never blocking a push
    // that has nothing to do with the doc that carries it.
    const findings = checkRegister({
      docs: [
        doc({
          path: "/board/other-repo.md",
          problems: ["doneWhen[0] must declare exactly one of present/absent/path/command, but declares 3"],
        }),
      ],
      landedPaths: NOTHING_LANDED,
      nonBlockingPaths: new Set(["/board/other-repo.md"]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.blocking).toBe(false);
    expect(findings[0]!.message).toContain("must declare exactly one of present/absent/path/command");
  });

  it("does not let one doc's non-blocking exemption reach a different doc's front-matter finding", () => {
    const findings = checkRegister({
      docs: [doc({ artifact: undefined, path: "/board/same-repo.md" })],
      landedPaths: NOTHING_LANDED,
      nonBlockingPaths: new Set(["/board/some-other-doc.md"]),
    });
    expect(findings[0]!.blocking).toBe(true);
  });

  it("marks a looks-shipped finding blocking when the caller supplies no non-blocking paths at all", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped" })],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings[0]!.blocking).toBe(true);
  });

  it("marks a looks-shipped finding advisory when its path is in the non-blocking set", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped" })],
      landedPaths: new Set(["/board/shipped.md"]),
      nonBlockingPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.blocking).toBe(false);
  });

  it("does not let one doc's non-blocking exemption reach a different doc's looks-shipped finding", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped" })],
      landedPaths: new Set(["/board/shipped.md"]),
      nonBlockingPaths: new Set(["/board/some-other-doc.md"]),
    });
    expect(findings[0]!.blocking).toBe(true);
  });
});

describe("checkRegister — `notDoneReason` silences the looks-shipped finding entirely", () => {
  it("reports nothing for a doc whose probes pass but which stated why that is not completion", () => {
    const findings = checkRegister({
      docs: [
        doc({
          notDoneReason: "Slice 1 probes only — the doc's own final handoff is a later slice",
          path: "/board/shipped.md",
          slug: "shipped",
        }),
      ],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings).toEqual([]);
  });

  it("still fails a doc with the identical probe state but no stated reason", () => {
    const findings = checkRegister({
      docs: [doc({ path: "/board/shipped.md", slug: "shipped" })],
      landedPaths: new Set(["/board/shipped.md"]),
    });
    expect(findings.length).toBe(1);
  });
});

describe("checkRegister — a draft whose probes already pass", () => {
  it("does NOT tell a draft to declare itself done, which would mark unstarted work finished", () => {
    const findings = checkRegister({
      docs: [doc({ status: "draft" })],
      landedPaths: new Set(["/board/sound.md"]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.fix).toBeUndefined();
    expect(findings[0]!.message).toContain("cannot tell built from unbuilt");
  });

  it("points a draft at its `doneWhen`, which is the thing actually wrong", () => {
    const findings = checkRegister({
      docs: [doc({ status: "draft" })],
      landedPaths: new Set(["/board/sound.md"]),
    });
    expect(findings[0]!.field).toBe("doneWhen");
  });
});

describe("checkRegister — a cancelled/rejected doc whose probes now land", () => {
  it.each(["cancelled", "rejected"] as const)(
    "does NOT tell a %s doc to author status: done — that would reverse a deliberate terminal call",
    (status) => {
      const findings = checkRegister({
        docs: [doc({ status })],
        landedPaths: new Set(["/board/sound.md"]),
      });
      expect(findings.length).toBe(1);
      expect(findings[0]!.fix).toBeUndefined();
      expect(findings[0]!.message).toContain("contradiction");
    },
  );

  it("stays silent when a cancelled doc explains the gap with notDoneReason", () => {
    const findings = checkRegister({
      docs: [doc({ notDoneReason: "shipped independently before the rejection", status: "rejected" })],
      landedPaths: new Set(["/board/sound.md"]),
    });
    expect(findings).toEqual([]);
  });
});

describe("checkRegister — a run parked on something already greenlit", () => {
  it("reports a doctrine violation against the doc whose journal carries the question", () => {
    const findings = checkRegister({
      docs: [doc()],
      landedPaths: NOTHING_LANDED,
      openQuestions: new Map([["sound", "Do I have permission to record the integration cassette?"]]),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.slug).toBe("sound");
    expect(findings[0]!.message).toContain("DOCTRINE VIOLATION");
    expect(findings[0]!.message).toContain(".claude/rules/testing.md § Recording a cassette is pre-approved");
  });

  it("points at no front-matter field, because nothing in the doc is what needs editing", () => {
    const findings = checkRegister({
      docs: [doc()],
      landedPaths: NOTHING_LANDED,
      openQuestions: new Map([["sound", "Should I record the cassette?"]]),
    });
    expect(findings[0]!.field).toBeUndefined();
    expect(findings[0]!.fix).toBeUndefined();
  });

  it("blocks the push by default, and does not when the doc names another repo or branch", () => {
    const blocking = checkRegister({
      docs: [doc()],
      landedPaths: NOTHING_LANDED,
      openQuestions: new Map([["sound", "Should I record the cassette?"]]),
    });
    expect(blocking[0]!.blocking).toBe(true);
    const advisory = checkRegister({
      docs: [doc()],
      landedPaths: NOTHING_LANDED,
      nonBlockingPaths: new Set(["/board/sound.md"]),
      openQuestions: new Map([["sound", "Should I record the cassette?"]]),
    });
    expect(advisory[0]!.blocking).toBe(false);
  });

  it("stays silent for an ordinary open question", () => {
    expect(
      checkRegister({
        docs: [doc()],
        landedPaths: NOTHING_LANDED,
        openQuestions: new Map([["sound", "Which of the three thresholds do you want?"]]),
      }),
    ).toEqual([]);
  });

  it("stays silent for a doc with no open question at all", () => {
    expect(checkRegister({ docs: [doc()], landedPaths: NOTHING_LANDED, openQuestions: new Map() })).toEqual([]);
  });
});
