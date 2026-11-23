import { describe, expect, it } from "vitest";
import { parseHandoverDoc } from "../../../handover/doc.js";
import {
  addFrontMatterFields,
  editFrontMatterFields,
  ensureArtifactDefault,
  frontMatterErrorLines,
  problemsLeft,
} from "../../../handover/frontmatter.js";
import { FrontMatterErrors } from "../../../handover/frontmatterErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const SOUND_DOC = `---
slug: sound
summary: a doc the board can place
status: ready
repo: /repo
---

# body
`;

describe("ensureArtifactDefault", () => {
  it("leaves a doc that already declares artifact: untouched", () => {
    const withArtifact = `---
slug: sound
artifact: https://claude.ai/code/artifact/aaaa
status: ready
---
`;
    const applied = unwrap(ensureArtifactDefault({ path: "/board/sound.md", text: withArtifact }));
    expect(applied.changed).toBe(false);
    expect(applied.text).toBe(withArtifact);
  });

  it("leaves a doc that already declares artifact: null untouched", () => {
    const withNull = `---
slug: sound
artifact: null
status: ready
---
`;
    const applied = unwrap(ensureArtifactDefault({ path: "/board/sound.md", text: withNull }));
    expect(applied.changed).toBe(false);
  });

  it("inserts artifact: null into a doc missing the key", () => {
    const applied = unwrap(ensureArtifactDefault({ path: "/board/sound.md", text: SOUND_DOC }));
    expect(applied.changed).toBe(true);
    expect(applied.text).toContain("\nartifact: null\n");
  });

  it("produces text register-hygiene reads as having a declared artifact after the fix", () => {
    const applied = unwrap(ensureArtifactDefault({ path: "/board/sound.md", text: SOUND_DOC }));
    const reparsed = parseHandoverDoc({ path: "/board/sound.md", text: applied.text });
    expect(reparsed.artifact).toBe("null");
  });

  it("preserves every other declared field when inserting the default", () => {
    const applied = unwrap(ensureArtifactDefault({ path: "/board/sound.md", text: SOUND_DOC }));
    const reparsed = parseHandoverDoc({ path: "/board/sound.md", text: applied.text });
    expect(reparsed.slug).toBe("sound");
    expect(reparsed.repo).toBe("/repo");
    expect(reparsed.status).toBe("ready");
  });

  it("refuses a doc whose front-matter has a genuine parse problem, rather than guessing", () => {
    const duplicateKey = `---
slug: sound
status: ready
status: draft
---
`;
    const result = ensureArtifactDefault({ path: "/board/sound.md", text: duplicateKey });
    expect(unwrapErr(result).code).toBe("DOC_MALFORMED");
    expect(unwrapErr(result).reasons[0]).toContain('declares "status" more than once');
  });

  it("refuses a doc with no closed front-matter block", () => {
    const result = ensureArtifactDefault({ path: "/board/sound.md", text: "# just a body, no front-matter\n" });
    expect(unwrapErr(result).code).toBe("FRONT_MATTER_UNCLOSED");
    expect(unwrapErr(result).reasons[0]).toContain("no closed front-matter block");
  });

  it("refuses a doneWhen: entry shaped kind:/path:/contains: instead of present:/absent:/path:/command:", () => {
    // The exact malformed shape a hand-authored doc used three times live — a `doneWhen:` entry
    // that reads as valid YAML but declares the wrong keys for a probe. `parseHandoverDoc` surfaces this as a
    // `problems` entry the same way it surfaces a duplicate flat key, so it refuses here too rather than
    // guessing at what the author meant.
    const wrongProbeShape = `---
slug: wrong-shape
status: ready
repo: /repo
doneWhen:
  - kind: file
    path: src/x.ts
    contains: "y"
---
`;
    const result = ensureArtifactDefault({ path: "/board/wrong-shape.md", text: wrongProbeShape });
    expect(unwrapErr(result).code).toBe("DOC_MALFORMED");
    expect(unwrapErr(result).reasons[0]).toContain("must declare exactly one of present/absent/path/command");
  });
});

describe("addFrontMatterFields", () => {
  const doc = [
    "---",
    "slug: ask",
    "kind: ask",
    "askedIso: 2026-08-30T23:08:43Z",
    "artifact: null",
    "---",
    "",
    "body",
  ].join("\n");

  it("appends each field in the order it was given, just inside the closing fence", () => {
    const result = addFrontMatterFields({
      fields: [
        { key: "settlement", value: "filed" },
        { key: "settlementWitness", value: "some-doc" },
      ],
      path: "/h/ask.md",
      text: doc,
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(
      [
        "---",
        "slug: ask",
        "kind: ask",
        "askedIso: 2026-08-30T23:08:43Z",
        "artifact: null",
        "settlement: filed",
        "settlementWitness: some-doc",
        "---",
        "",
        "body",
      ].join("\n"),
    );
  });

  it("refuses a key the doc already declares, because a repeat makes the row malformed rather than updated", () => {
    const result = addFrontMatterFields({
      fields: [{ key: "kind", value: "doc" }],
      path: "/h/ask.md",
      text: doc,
    });

    expect(unwrapErr(result).code).toBe("KEY_ALREADY_DECLARED");
    expect(unwrapErr(result).reasons).toEqual(['front-matter already declares "kind" — edit it by hand instead']);
    expect(unwrapErr(result)).toEqual(FrontMatterErrors.alreadyDeclared({ keys: ["kind"] }));
  });

  it("refuses a key declared with a space before its colon, which the reader reads as the same key", () => {
    const spaced = [
      "---",
      "slug: ask",
      "kind: ask",
      "askedIso: 2026-08-30T23:08:43Z",
      "artifact: null",
      "repo :",
      "---",
      "",
    ].join("\n");
    const result = addFrontMatterFields({
      fields: [{ key: "repo", value: "/w/repo" }],
      path: "/h/ask.md",
      text: spaced,
    });

    expect(unwrapErr(result).code).toBe("KEY_ALREADY_DECLARED");
    expect(unwrapErr(result).reasons).toEqual(['front-matter already declares "repo" — edit it by hand instead']);
    expect(unwrapErr(result)).toEqual(FrontMatterErrors.alreadyDeclared({ keys: ["repo"] }));
  });

  it("refuses a splice the reader would call malformed, rather than returning it to be written", () => {
    const result = addFrontMatterFields({
      fields: [{ key: "settlement", value: "filed" }],
      path: "/h/ask.md",
      text: doc,
    });

    expect(unwrapErr(result).code).toBe("DOC_MALFORMED");
    expect(unwrapErr(result).reasons).toEqual([
      "settlement: filed declares no settlementWitness — a settled ask names the doc slug, the permalink or the anchor behind it, so nobody has to take a session's word for it",
    ]);
  });

  it("refuses a value carrying a line break, which would write a key nobody passed and parse clean", () => {
    const result = addFrontMatterFields({
      fields: [
        { key: "settlement", value: "filed" },
        { key: "settlementWitness", value: "w\nrepo: /not/a/checkout" },
      ],
      path: "/h/ask.md",
      text: doc,
    });

    expect(unwrapErr(result).code).toBe("VALUE_HAS_LINE_BREAK");
    expect(unwrapErr(result).reasons).toEqual([
      '"settlementWitness" carries a line break, and front-matter is read line by line',
    ]);
  });

  it("prints a plural refusal one reason per line, never as the joined message", () => {
    const refused = unwrapErr(
      addFrontMatterFields({
        fields: [
          { key: "settlement", value: "filed\nx: y" },
          { key: "settlementWitness", value: "w\nrepo: /not/a/checkout" },
        ],
        path: "/h/ask.md",
        text: doc,
      }),
    );

    expect(frontMatterErrorLines({ error: refused })).toStrictEqual([
      '"settlement" carries a line break, and front-matter is read line by line',
      '"settlementWitness" carries a line break, and front-matter is read line by line',
    ]);
  });

  it("refuses a doc whose front-matter is already broken rather than splicing into it", () => {
    const broken = ["---", "slug: ask", "slug: ask", "---", ""].join("\n");
    const result = addFrontMatterFields({
      fields: [{ key: "settlement", value: "filed" }],
      path: "/h/ask.md",
      text: broken,
    });

    expect(unwrapErr(result).code).toBe("DOC_MALFORMED");
    expect(unwrapErr(result).reasons).toEqual(['front-matter declares "slug" more than once — which one is meant?']);
  });

  it("refuses a file with no front-matter block at all", () => {
    const result = addFrontMatterFields({
      fields: [{ key: "settlement", value: "filed" }],
      path: "/h/ask.md",
      text: "body",
    });

    expect(unwrapErr(result).code).toBe("FRONT_MATTER_UNCLOSED");
    expect(unwrapErr(result).reasons).toEqual(["no closed front-matter block (`---` … `---`) to add to"]);
    expect(unwrapErr(result)).toEqual(FrontMatterErrors.unclosed({ purpose: "add to" }));
  });
});

describe("editFrontMatterFields", () => {
  it("replaces a declared scalar in place, leaving its position alone", () => {
    const edited = unwrap(
      editFrontMatterFields({
        path: "/h/sound.md",
        remove: [],
        set: [{ key: "status", value: "paused" }],
        text: SOUND_DOC,
      }),
    );

    expect(edited).toBe(`---
slug: sound
summary: a doc the board can place
status: paused
repo: /repo
---

# body
`);
  });

  it("appends a key the doc does not declare, and the parser reads it back", () => {
    const edited = unwrap(
      editFrontMatterFields({
        path: "/h/sound.md",
        remove: [],
        set: [
          { key: "status", value: "paused" },
          { key: "pausedOn", value: "a reviewer" },
        ],
        text: SOUND_DOC,
      }),
    );
    const doc = parseHandoverDoc({ path: "/h/sound.md", text: edited });

    expect(doc.status).toBe("paused");
    expect(doc.pausedOn).toBe("a reviewer");
    expect(doc.problems).toEqual([]);
  });

  it("removes a declared key and ignores one that was never there", () => {
    const paused = unwrap(
      editFrontMatterFields({
        path: "/h/sound.md",
        remove: [],
        set: [
          { key: "status", value: "paused" },
          { key: "pausedOn", value: "a reviewer" },
        ],
        text: SOUND_DOC,
      }),
    );
    const resumed = unwrap(
      editFrontMatterFields({
        path: "/h/sound.md",
        remove: ["pausedOn", "pausedSince"],
        set: [{ key: "status", value: "ready" }],
        text: paused,
      }),
    );
    const doc = parseHandoverDoc({ path: "/h/sound.md", text: resumed });

    expect(doc.status).toBe("ready");
    expect(doc.pausedOn).toBe(undefined);
    expect(doc.problems).toEqual([]);
  });

  /** A nested `doneWhen:` entry is indented, so the top-level anchor can never reach it. */
  it("never touches a nested probe line that shares a key's prefix", () => {
    const withProbes = `---
slug: sound
status: ready
doneWhen:
  - path: src/a.ts
---

# body
`;
    const edited = unwrap(
      editFrontMatterFields({
        path: "/h/sound.md",
        remove: ["path"],
        set: [{ key: "status", value: "paused" }],
        text: withProbes,
      }),
    );

    expect(edited).toContain("  - path: src/a.ts");
  });

  it("refuses a doc whose front-matter does not parse cleanly", () => {
    const broken = `---
slug: sound
slug: sound-again
status: ready
---

# body
`;
    const result = editFrontMatterFields({
      path: "/h/sound.md",
      remove: [],
      set: [{ key: "status", value: "paused" }],
      text: broken,
    });

    expect(unwrapErr(result).code).toBe("DOC_MALFORMED");
    expect(unwrapErr(result).reasons).toEqual(['front-matter declares "slug" more than once — which one is meant?']);
  });

  it("refuses a file with no front-matter block at all", () => {
    const result = editFrontMatterFields({
      path: "/h/sound.md",
      remove: [],
      set: [{ key: "status", value: "paused" }],
      text: "body",
    });

    expect(unwrapErr(result).code).toBe("FRONT_MATTER_UNCLOSED");
    expect(unwrapErr(result).reasons).toEqual(["no closed front-matter block (`---` … `---`) to edit"]);
  });
});

/*
 * A comment is no key's value, so it never goes with one. The counterexample: `handover withdraw` replaced `status:` and deleted the provenance note under it, and the read-back
 * compared parsed fields only, so it passed.
 */
describe("problemsLeft", () => {
  it("consumes each repaired problem once, in order, and keeps everything it was not told about", () => {
    expect(problemsLeft({ problems: ["a", "b", "a", "c"], repairing: ["a", "c", "z"] })).toEqual(["b", "a"]);
  });

  it("keeps every problem when nothing is being repaired", () => {
    expect(problemsLeft({ problems: ["a", "b"], repairing: [] })).toEqual(["a", "b"]);
  });
});

describe("editFrontMatterFields keeps every comment", () => {
  const NOTED = `---
slug: row
status: ready
# audit note: preserve this provenance
registeredBy: a-session
---

# body
`;

  it("keeps a comment under a key it replaces, byte for byte", () => {
    const edited = unwrap(
      editFrontMatterFields({
        path: "/h/row.md",
        remove: [],
        set: [{ key: "status", value: "cancelled" }],
        text: NOTED,
      }),
    );

    expect(edited).toBe(`---
slug: row
status: cancelled
# audit note: preserve this provenance
registeredBy: a-session
---

# body
`);
  });

  it("keeps a comment under a key it removes", () => {
    const edited = unwrap(editFrontMatterFields({ path: "/h/row.md", remove: ["status"], set: [], text: NOTED }));

    expect(edited).toBe(`---
slug: row
# audit note: preserve this provenance
registeredBy: a-session
---

# body
`);
  });

  it("drops value text below a comment with the key it belongs to, as the reader folds it", () => {
    const text = "---\nslug: row\nstatusSummary: first\n# a note\n  more of the first\nstatus: ready\n---\n";

    const edited = unwrap(
      editFrontMatterFields({ path: "/h/row.md", remove: [], set: [{ key: "statusSummary", value: "new" }], text }),
    );

    expect(parseHandoverDoc({ path: "/h/row.md", text }).statusSummary).toBe("first more of the first");
    expect(edited).toBe("---\nslug: row\nstatusSummary: new\n# a note\nstatus: ready\n---\n");
  });

  it("drops a block scalar whole, the blank line inside it included", () => {
    const text = "---\nslug: row\nstatusSummary: >\n  first\n\n  second\nstatus: ready\n---\n";

    const edited = unwrap(editFrontMatterFields({ path: "/h/row.md", remove: ["statusSummary"], set: [], text }));

    expect(edited).toBe("---\nslug: row\nstatus: ready\n---\n");
  });

  it("drops an indented `#` line inside a block with the block, because there it is text", () => {
    const text = "---\nslug: row\nstatusSummary: >\n  # a heading in the text\n  the rest\nstatus: ready\n---\n";

    const edited = unwrap(
      editFrontMatterFields({ path: "/h/row.md", remove: [], set: [{ key: "statusSummary", value: "new" }], text }),
    );

    expect(edited).toBe("---\nslug: row\nstatusSummary: new\nstatus: ready\n---\n");
  });

  it("keeps a blank line that separates a dropped key from a comment or the next key", () => {
    const text = "---\nslug: row\nsummary: s\n\n# a note\nstatusSummary: t\n\nstatus: ready\n---\n";

    const edited = unwrap(
      editFrontMatterFields({ path: "/h/row.md", remove: ["summary", "statusSummary"], set: [], text }),
    );

    expect(edited).toBe("---\nslug: row\n\n# a note\n\nstatus: ready\n---\n");
  });
});

/*
 * A flat value the reader would read back as something else is refused before anything is spliced, because the
 * read-back never judges a key the caller asked for.
 */
describe("editFrontMatterFields refuses a flat value it cannot write as one line", () => {
  it("refuses a line break, which closed the front matter early and read back as a prefix", () => {
    const text = "---\nslug: row\nstatus: ready\nstatusSummary: old\n  old tail\n---\n";

    const refused = unwrapErr(
      editFrontMatterFields({
        path: "/h/row.md",
        remove: [],
        set: [{ key: "statusSummary", value: "new\n---" }],
        text,
      }),
    );

    expect(refused).toEqual(FrontMatterErrors.lineBreak({ keys: ["statusSummary"] }));
  });

  it("refuses a lone block indicator, which reads its value from a comment kept below it", () => {
    const text = "---\nslug: row\nstatusSummary: old\n  # provenance\nstatus: ready\n---\n";

    const refused = unwrapErr(
      editFrontMatterFields({ path: "/h/row.md", remove: [], set: [{ key: "statusSummary", value: ">" }], text }),
    );

    expect(refused).toEqual(FrontMatterErrors.blockIndicator({ keys: ["statusSummary"] }));
  });

  it("refuses a key that is no bare name, which matched a line spelled differently", () => {
    const text = "---\nslug: row\nsummary: s\nstatus   : ready\n---\n";

    const refused = unwrapErr(
      editFrontMatterFields({ path: "/h/row.md", remove: ["a.b"], set: [{ key: "status ", value: "ready" }], text }),
    );

    expect(refused).toEqual(FrontMatterErrors.keyNotAName({ keys: ["status ", "a.b"] }));
  });

  it("refuses a key named both to write and to delete, which was removed and then appended", () => {
    const text = "---\nslug: row\ncustom: old\nstatus: ready\n---\n";

    const refused = unwrapErr(
      editFrontMatterFields({ path: "/h/row.md", remove: ["custom"], set: [{ key: "custom", value: "new" }], text }),
    );

    expect(refused).toEqual(FrontMatterErrors.setAndRemove({ keys: ["custom"] }));
  });

  it("refuses a key named twice to write, whose second value was dropped", () => {
    const text = "---\nslug: row\nstatus: ready\n---\n";
    const set = [
      { key: "status", value: "paused" },
      { key: "statusSummary", value: "held" },
      { key: "status", value: "done" },
      { key: "status", value: "ready" },
    ];

    const refused = unwrapErr(editFrontMatterFields({ path: "/h/row.md", remove: [], set, text }));

    expect(refused).toEqual(FrontMatterErrors.setTwice({ keys: ["status"] }));
  });
});

/*
 * A nested key's value is many lines by design, but a line of it at column 0 is a key or a fence of its own: an
 * early `---` hid the flat key written beside it, and a `status:` line overwrote it.
 */
describe("editFrontMatterFields refuses a nested value with a line at column 0", () => {
  const text = "---\nslug: row\ndoneWhen:\n  - path: src/a.ts\nstatus: ready\n---\n";

  it("refuses a nested value whose own fence would hide an asked flat key", () => {
    const set = [
      { key: "doneWhen", value: "\n---" },
      { key: "status", value: "paused" },
    ];

    const refused = unwrapErr(editFrontMatterFields({ path: "/h/row.md", remove: [], set, text }));

    expect(refused).toEqual(FrontMatterErrors.nestedLineUnindented({ keys: ["doneWhen"] }));
  });

  it("refuses a nested value that would write an asked flat key with another value ahead of its fence", () => {
    const set = [
      { key: "doneWhen", value: "\nstatus: hijacked\n---" },
      { key: "status", value: "paused" },
    ];

    const refused = unwrapErr(editFrontMatterFields({ path: "/h/row.md", remove: [], set, text }));

    expect(refused).toEqual(FrontMatterErrors.nestedLineUnindented({ keys: ["doneWhen"] }));
  });

  it("writes a nested value whose every line past the first is indented", () => {
    const set = [{ key: "doneWhen", value: "\n  - path: src/b.ts\n\n  - path: src/c.ts" }];

    const edited = unwrap(editFrontMatterFields({ path: "/h/row.md", remove: [], set, text }));

    expect(edited).toBe("---\nslug: row\ndoneWhen: \n  - path: src/b.ts\n\n  - path: src/c.ts\nstatus: ready\n---\n");
  });
});
