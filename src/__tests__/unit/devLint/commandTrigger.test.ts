import { describe, expect, it } from "vitest";
import { LISTING_MAX_CHARS, scanCommandTrigger } from "../../../devLint/commandTrigger.js";

/** A command file, front matter plus a token body, so every fixture reads as the real shape. */
function command({ frontMatter }: { frontMatter: string }): string {
  return `---\n${frontMatter}\n---\n\nRun the verb and report the result.\n`;
}

const kinds = ({ frontMatter }: { frontMatter: string }): readonly string[] =>
  scanCommandTrigger({ content: command({ frontMatter }), path: "skills/probe/SKILL.md" }).map((issue) => issue.kind);

describe("scanCommandTrigger", () => {
  it("refuses trigger phrases parked in when_to_use, which a skill listing never reads", () => {
    expect(
      kinds({
        frontMatter: [
          "description: Post to Slack from the world model as the bot or under your own name",
          'when_to_use: When the user asks to send, post or announce something in Slack. Phrases like "post this to Slack" or "send it to the team".',
        ].join("\n"),
      }),
    ).toEqual(["when-to-use"]);
  });

  it("accepts a description carrying its own use-when clause, which is the shipped reference shape", () => {
    expect(
      kinds({
        frontMatter:
          "description: Read a Slack thread from its permalink. Use whenever a Slack link appears and the user wants to know what it says",
      }),
    ).toEqual([]);
  });

  it("rejects the colon-space trigger spelling that shipped in loop.md and rendered anyway", () => {
    const issues = scanCommandTrigger({
      content: command({
        frontMatter: 'description: Be the bot, continuously. Triggers: "run the bot", "start the loop".',
      }),
      path: "skills/loop/SKILL.md",
    });

    // TWO errors, not one: the colon-space opens a nested mapping and the rest of the line is then an
    // unexpected scalar. Reporting only the first is what the earlier version did, and it hid half of this.
    expect(issues.map((issue) => issue.kind)).toEqual(["yaml", "yaml"]);
    expect(issues[0]!.path).toBe("skills/loop/SKILL.md");
    expect(issues[0]!.line).toBe(2);
    expect(issues[0]!.message).toContain("Nested mappings are not allowed");
    expect(issues[0]!.message).toContain("colon followed by a space");
    expect(issues[1]!.message).toContain("Unexpected scalar at node end");
  });

  it("rejects a file with no front matter at all", () => {
    const issues = scanCommandTrigger({ content: "# Just a heading\n\nSome prose.\n", path: "skills/probe/SKILL.md" });

    expect(issues.map((issue) => issue.kind)).toEqual(["frontmatter"]);
    expect(issues[0]!.line).toBe(1);
  });

  it("rejects front matter that is opened and never closed", () => {
    expect(
      scanCommandTrigger({ content: "---\ndescription: x\n", path: "skills/probe/SKILL.md" }).map(
        (issue) => issue.kind,
      ),
    ).toEqual(["frontmatter"]);
  });

  it("ignores a --- block that is not the first line, because the harness reads only the top", () => {
    expect(
      scanCommandTrigger({
        content: "Some prose first.\n\n---\ndescription: Use it when you need it\n---\n",
        path: "skills/probe/SKILL.md",
      }).map((issue) => issue.kind),
    ).toEqual(["frontmatter"]);
  });

  it("rejects front matter with no description, since the listing is built from it", () => {
    expect(kinds({ frontMatter: 'argument-hint: "<question>"' })).toEqual(["description"]);
  });

  it("rejects a description that is not a string", () => {
    expect(kinds({ frontMatter: "description: 42" })).toEqual(["description"]);
  });

  it("rejects an empty description", () => {
    expect(kinds({ frontMatter: 'description: ""' })).toEqual(["description"]);
  });

  it("rejects a description that says what the command IS and never when to load it", () => {
    const issues = scanCommandTrigger({
      content: command({ frontMatter: "description: Ask a grounded, cited question of your local world model" }),
      path: "skills/store/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["trigger"]);
    expect(issues[0]!.message).toContain("when to load it");
  });

  it("rejects a description over the listing cap", () => {
    const issues = scanCommandTrigger({
      content: command({ frontMatter: `description: Use it when you need it, ${"x".repeat(LISTING_MAX_CHARS)}` }),
      path: "skills/probe/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["listing-cap"]);
    expect(issues[0]!.message).toContain("over the 1536 the listing truncates at");
    expect(issues[0]!.message).not.toContain("sit at the end");
  });

  it("accepts a combined length exactly at the cap, so the boundary is inclusive", () => {
    const prefix = "Use it when you need it. ";
    expect(kinds({ frontMatter: `description: ${prefix}${"x".repeat(LISTING_MAX_CHARS - prefix.length)}` })).toEqual(
      [],
    );
  });

  it("reports every independent issue in one scan rather than stopping at the first", () => {
    expect(kinds({ frontMatter: `description: A verb that does a thing ${"x".repeat(LISTING_MAX_CHARS)}` })).toEqual([
      "listing-cap",
      "trigger",
    ]);
  });

  it("reports the line the description sits on, not the top of the file", () => {
    const issues = scanCommandTrigger({
      content: command({ frontMatter: ['argument-hint: "<q>"', "description: A verb that does a thing"].join("\n") }),
      path: "skills/probe/SKILL.md",
    });

    expect(issues[0]!.line).toBe(3);
  });
});

describe("YAML failures are reported in full, not collapsed to the earliest", () => {
  it("reports EVERY independent YAML error, so one run lists them all", () => {
    // Found adversarially: the scanner's own doc-comment promised every issue while the YAML branch
    // returned only `errors[0]`. Two duplicate keys are two independent defects.
    const issues = scanCommandTrigger({
      content: command({
        frontMatter: ["name: a", "name: b", "description: first", "description: second"].join("\n"),
      }),
      path: "skills/probe/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["yaml", "yaml"]);
  });

  it("attaches the colon-space repair only to the failure it actually explains", () => {
    const duplicates = scanCommandTrigger({
      content: command({ frontMatter: ["description: first", "description: second"].join("\n") }),
      path: "skills/probe/SKILL.md",
    });
    const colonSpace = scanCommandTrigger({
      content: command({ frontMatter: 'description: Be the bot. Triggers: "run the bot".' }),
      path: "skills/loop/SKILL.md",
    });

    expect(duplicates[0]!.message).not.toContain("colon followed by a space");
    expect(colonSpace[0]!.message).toContain("colon followed by a space");
  });
});

describe("the two early exits are deliberate, not stop-at-first", () => {
  it("says only that an unusable description must exist, without piling on the trigger finding", () => {
    // Found adversarially: this input independently lacks trigger information too, and the scanner is right
    // to stay quiet about it — every remaining check is about the description's CONTENT. Pinned so the
    // early return reads as a decision rather than an oversight.
    expect(kinds({ frontMatter: 'description: ""' })).toEqual(["description"]);
    expect(kinds({ frontMatter: 'argument-hint: "<q>"' })).toEqual(["description"]);
  });

  it("reports the trigger finding as soon as there IS a description to judge", () => {
    expect(kinds({ frontMatter: "description: A verb that does a thing" })).toEqual(["trigger"]);
  });
});

describe("the listing cap now covers the description alone", () => {
  it("charges no separator, because there is no second field to join", () => {
    // While these verbs were command files the listing rendered `description` + " - " + `when_to_use`, and
    // this check had to charge those three characters. A skill listing renders the description and stops, so
    // a fixture exactly at the ceiling must PASS — it would have been refused by three under the old sum.
    const prefix = "Use it when you need it. ";
    const atCap = `${prefix}${"x".repeat(LISTING_MAX_CHARS - prefix.length)}`;

    expect(atCap.length).toBe(LISTING_MAX_CHARS);
    expect(kinds({ frontMatter: `description: ${atCap}` })).toEqual([]);
  });
});

describe("an explicit YAML null description", () => {
  it("is treated as absent, because the advice is the same — write one", () => {
    const explicit = scanCommandTrigger({
      content: command({ frontMatter: "description: null" }),
      path: "skills/probe/SKILL.md",
    });
    const bare = scanCommandTrigger({
      content: command({ frontMatter: "description:" }),
      path: "skills/probe/SKILL.md",
    });

    expect(explicit.map((issue) => issue.kind)).toEqual(["description"]);
    expect(explicit[0]!.message).toContain("no `description:`");
    expect(bare[0]!.message).toBe(explicit[0]!.message);
  });
});

describe("the reported line matches what the YAML parser actually read", () => {
  it("finds a QUOTED description key, so the finding and its line agree", () => {
    // Found by review: YAML treats `"description":` as the same field, so the finding was correct while the
    // line number pointed at the top of the block. A line finder narrower than its parser misdirects readers.
    const issues = scanCommandTrigger({
      content: command({ frontMatter: ['argument-hint: "<q>"', '"description": A verb that does a thing'].join("\n") }),
      path: "skills/probe/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["trigger"]);
    expect(issues[0]!.line).toBe(3);
  });
});

describe("when_to_use is dead metadata in a SKILL.md, whatever shape it takes", () => {
  // It was a real field while these verbs lived in `commands/`, and the listing appended it. A skill has no
  // such field, so the phrases written there reach no model while LOOKING like they say when to load.
  it("refuses it as text", () => {
    const issues = scanCommandTrigger({
      content: command({
        frontMatter: ["description: A verb that does a thing", "when_to_use: When you need it"].join("\n"),
      }),
      path: "skills/probe/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["when-to-use"]);
    expect(issues[0]!.line).toBe(3);
    expect(issues[0]!.message).toContain("is not a field a skill has");
  });

  it("refuses it as a number", () => {
    expect(kinds({ frontMatter: ["description: A verb that does a thing", "when_to_use: 1"].join("\n") })).toEqual([
      "when-to-use",
    ]);
  });

  it("refuses an explicit null, which an author reads as harmless", () => {
    expect(kinds({ frontMatter: ["description: Use when needed", "when_to_use: null"].join("\n") })).toEqual([
      "when-to-use",
    ]);
  });

  it("refuses an empty string", () => {
    expect(kinds({ frontMatter: ["description: Use when needed", 'when_to_use: ""'].join("\n") })).toEqual([
      "when-to-use",
    ]);
  });

  it("reports it ALONE, so the one finding that explains the others is not buried", () => {
    expect(
      kinds({ frontMatter: ["description: A verb that does a thing", "when_to_use: When you need it"].join("\n") }),
    ).toEqual(["when-to-use"]);
  });
});

describe("the line finder never reads the body", () => {
  it("does not let a description: written in body prose answer for a front matter that has none", () => {
    // Review found this: scanning the whole file matched the BODY occurrence, so the finding was correct
    // while its line pointed at text the harness never reads.
    const issues = scanCommandTrigger({
      content: '---\nargument-hint: "<q>"\n---\n\ndescription: body prose\n',
      path: "skills/probe/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["description"]);
    expect(issues[0]!.line).toBe(2);
  });
});

describe("the line finder reads only TOP-LEVEL keys", () => {
  it("does not let an indented nested key answer for the top-level field", () => {
    // Review found this: `^\s*` matched `  description:` nested under another mapping, so a front matter
    // with no top-level description reported the nested line instead of the block's first field line.
    const issues = scanCommandTrigger({
      content: '---\nargument-hint: "<q>"\nmeta:\n  description: nested prose\n---\n\nBody.\n',
      path: "skills/probe/SKILL.md",
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["description"]);
    expect(issues[0]!.line).toBe(2);
  });
});

describe("a description with no use-when clause", () => {
  it("is refused, because the body cannot say when to load a skill that was never chosen", () => {
    expect(kinds({ frontMatter: "description: A verb that does a thing" })).toEqual(["trigger"]);
  });

  it("is not rescued by the word `when` a whole sentence away from the word `use`", () => {
    expect(
      kinds({
        frontMatter: "description: Use the world model. A separate sentence that happens to say when later.",
      }),
    ).toEqual(["trigger"]);
  });
});
