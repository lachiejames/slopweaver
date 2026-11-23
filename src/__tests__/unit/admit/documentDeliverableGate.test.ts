/** The gate that refuses to hand a room a path on the owner's own laptop, and the markdown-first rule. */
import { describe, expect, it } from "vitest";

import {
  answerPlainText,
  documentDeliverableFindings,
  documentDeliverableGate,
  LOCAL_PAGE_PATH_CODE,
  LOCAL_PAGE_PATH_OVERRIDE,
  localPagePathsInText,
  MARKDOWN_FIRST_CODE,
  MARKDOWN_FIRST_OVERRIDE,
  markdownFirstVerdict,
} from "../../../admit/documentDeliverableGate.js";
import { admitDoor } from "../../../admit/door.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** The exact path shape the four-ISO-docs turn put in a team channel. */
const MEASURED_PATH = "~/.slopweaver/pages/iso-27001-controls/index.html";

function answer(over: Partial<AnswerFormAnswer> = {}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: { model: "the dispatched worker", skillsLoaded: [], verbsLoaded: [] },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the four ISO pages are written",
    measurements: [],
    ...over,
  };
}

function codes({ findings }: { findings: readonly { readonly code: string }[] }): readonly string[] {
  return findings.map((finding) => finding.code);
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "turn", verb: "answer" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("localPagePathsInText", () => {
  it("finds the tilde-rooted path the measured turn actually posted", () => {
    expect(localPagePathsInText({ text: `the four pages are files under ${MEASURED_PATH} on your mac` })).toEqual([
      MEASURED_PATH,
    ]);
  });

  it("finds an absolute path under a dotfile home", () => {
    expect(localPagePathsInText({ text: "see /Users/someone/.slopweaver/pages/soc2-gaps/index.html for it" })).toEqual([
      "/Users/someone/.slopweaver/pages/soc2-gaps/index.html",
    ]);
  });

  it("finds a path written with the home variable", () => {
    expect(localPagePathsInText({ text: "$SLOPWEAVER_HOME/pages/queue-drain/index.html" })).toEqual([
      "$SLOPWEAVER_HOME/pages/queue-drain/index.html",
    ]);
  });

  it("finds a file:// page address, which the pages pattern already owns", () => {
    const url = "file:///Users/someone/.slopweaver/pages/iso-27001-controls/index.html";
    expect(localPagePathsInText({ text: `open ${url} please` })).toEqual([url]);
  });

  it("strips the sentence punctuation a composer writes around a path", () => {
    expect(localPagePathsInText({ text: `it is at \`${MEASURED_PATH}\`.` })).toEqual([MEASURED_PATH]);
  });

  it("reports each distinct path once, in first-appearance order", () => {
    const second = "~/.slopweaver/pages/soc2-gaps/index.html";
    expect(localPagePathsInText({ text: `${MEASURED_PATH} then ${second} then ${MEASURED_PATH}` })).toEqual([
      MEASURED_PATH,
      second,
    ]);
  });

  it("claims nothing in an https URL whose own route contains /pages/", () => {
    expect(localPagePathsInText({ text: "https://docs.example.com/pages/onboarding/index.html" })).toEqual([]);
  });

  it("claims nothing in a bare web route", () => {
    expect(localPagePathsInText({ text: "the app renders /pages/settings when you click through" })).toEqual([]);
  });

  it("claims nothing when a pages segment has no slug after it", () => {
    expect(localPagePathsInText({ text: "~/.slopweaver/pages/ is where they land" })).toEqual([]);
  });

  it("finds nothing in an answer that names no path at all", () => {
    expect(localPagePathsInText({ text: "the pool exhausted at 03:00Z and recovered by 03:12Z" })).toEqual([]);
  });
});

describe("answerPlainText", () => {
  it("reads the lead, the index and the body — the measured turn put its paths below the fold", () => {
    const text = answerPlainText({
      answer: answer({
        body: [{ columns: ["path"], rows: [[[{ text: MEASURED_PATH, type: "text" }]]], type: "table" }],
        index: [[{ text: "four pages written", type: "text" }]],
        lead: "done",
      }),
    });

    expect(text).toBe(`done four pages written ${MEASURED_PATH}`);
  });

  it("reads a link's URL as well as its label", () => {
    const text = answerPlainText({
      answer: answer({
        body: [{ runs: [{ label: "the page", type: "link", url: "https://example.test/x" }], type: "paragraph" }],
        lead: "here",
      }),
    });

    expect(text).toBe("here the page https://example.test/x");
  });
});

describe("markdownFirstVerdict", () => {
  it("passes an empty lane — whether a deliverable was owed is another gate's question", () => {
    expect(markdownFirstVerdict({ documents: [] })).toEqual({ kind: "ok" });
  });

  it("passes markdown alone", () => {
    expect(markdownFirstVerdict({ documents: ["/tmp/iso.md"] })).toEqual({ kind: "ok" });
  });

  it("passes markdown then html", () => {
    expect(markdownFirstVerdict({ documents: ["/tmp/iso.md", "/tmp/iso.html"] })).toEqual({ kind: "ok" });
  });

  it("names html with nothing beside it", () => {
    expect(markdownFirstVerdict({ documents: ["/tmp/iso.html"] })).toEqual({ kind: "html-only" });
  });

  it("names html listed before the markdown", () => {
    expect(markdownFirstVerdict({ documents: ["/tmp/iso.html", "/tmp/iso.md"] })).toEqual({
      kind: "html-before-markdown",
    });
  });

  it("reads .markdown as markdown", () => {
    expect(markdownFirstVerdict({ documents: ["/tmp/iso.markdown", "/tmp/iso.htm"] })).toEqual({ kind: "ok" });
  });
});

describe("documentDeliverableFindings", () => {
  const withPath = answer({
    body: [{ columns: ["path"], rows: [[[{ text: MEASURED_PATH, type: "text" }]]], type: "table" }],
    lead: "nothing uploaded anywhere",
  });

  it("refuses the measured answer on a channel, naming the path it handed the room", () => {
    const findings = documentDeliverableFindings({ answer: withPath, surface: "channel" });

    expect(codes({ findings })).toEqual([LOCAL_PAGE_PATH_CODE]);
    expect(findings[0]!.summary).toContain(MEASURED_PATH);
    expect(findings[0]!.severity).toBe("warn");
  });

  it("names the documents lane in its correction", () => {
    const findings = documentDeliverableFindings({ answer: withPath, surface: "channel" });

    expect(findings[0]!.correction).toContain("documents");
  });

  it("says nothing about the SAME answer in a DM — it is the owner's machine and the file is there", () => {
    expect(documentDeliverableFindings({ answer: withPath, surface: "dm" })).toEqual([]);
  });

  it("still refuses when the answer attaches a document AND names the path", () => {
    const both = answer({
      body: [{ columns: ["path"], rows: [[[{ text: MEASURED_PATH, type: "text" }]]], type: "table" }],
      documents: ["/tmp/iso.md"],
    });

    expect(codes({ findings: documentDeliverableFindings({ answer: both, surface: "channel" }) })).toEqual([
      LOCAL_PAGE_PATH_CODE,
    ]);
  });

  it("fires the markdown-first finding on a DM too — the lane's rule is not about the room", () => {
    const htmlOnly = answer({ documents: ["/tmp/iso.html"] });

    expect(codes({ findings: documentDeliverableFindings({ answer: htmlOnly, surface: "dm" }) })).toEqual([
      MARKDOWN_FIRST_CODE,
    ]);
  });

  it("quotes the owner's own words back on the markdown-first finding", () => {
    const findings = documentDeliverableFindings({ answer: answer({ documents: ["/tmp/iso.html"] }), surface: "dm" });

    expect(findings[0]!.summary).toContain("markdown is the preferred form for a deliverable");
  });

  it("reports both findings when an answer breaks both rules", () => {
    const both = answer({
      body: [{ columns: ["path"], rows: [[[{ text: MEASURED_PATH, type: "text" }]]], type: "table" }],
      documents: ["/tmp/iso.html"],
    });

    expect(codes({ findings: documentDeliverableFindings({ answer: both, surface: "channel" }) })).toEqual([
      LOCAL_PAGE_PATH_CODE,
      MARKDOWN_FIRST_CODE,
    ]);
  });

  it("says nothing about a clean answer that attaches its markdown and names no path", () => {
    const clean = answer({ documents: ["/tmp/iso.md", "/tmp/iso.html"], lead: "the four ISO pages are attached" });

    expect(documentDeliverableFindings({ answer: clean, surface: "channel" })).toEqual([]);
  });
});

describe("documentDeliverableGate at the door", () => {
  const withPath = answer({ lead: `the pages are under ${MEASURED_PATH}` });

  it("holds the send, so the answer cannot go out naming a path nobody can open", () => {
    const decision = admitDoor({
      env: {},
      gates: [documentDeliverableGate({ answer: withPath, surface: "channel" })],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(codes({ findings: decision.findings })).toEqual([LOCAL_PAGE_PATH_CODE]);
  });

  it("waives the markdown-first finding on its OWN token, never on the path one", () => {
    const htmlOnly = answer({ documents: ["/tmp/iso.html"] });
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: MARKDOWN_FIRST_OVERRIDE },
      gates: [documentDeliverableGate({ answer: htmlOnly, surface: "dm" })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(codes({ findings: decision.overridden })).toEqual([MARKDOWN_FIRST_CODE]);
  });

  it("does NOT waive the path finding on the markdown-first token", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: MARKDOWN_FIRST_OVERRIDE },
      gates: [documentDeliverableGate({ answer: withPath, surface: "channel" })],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(codes({ findings: decision.findings })).toEqual([LOCAL_PAGE_PATH_CODE]);
  });

  it("passes on the named override, and records what it waived", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: LOCAL_PAGE_PATH_OVERRIDE },
      gates: [documentDeliverableGate({ answer: withPath, surface: "channel" })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(codes({ findings: decision.overridden })).toEqual([LOCAL_PAGE_PATH_CODE]);
  });
});
