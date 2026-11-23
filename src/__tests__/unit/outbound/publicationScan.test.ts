import { describe, expect, it } from "vitest";
import { parsePrivateTerms, WITHHELD_REFUSAL_LINE } from "../../../hygiene/privateTerms.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type PublicationHygiene,
  publicationFindings,
  publicationRefusalLines,
  publicationSurfaceLabel,
  scanPublication,
} from "../../../outbound/publicationScan.js";

/** No private denylist: the credential classes and the committed identifier rules still apply. */
const CLEAN_HYGIENE: PublicationHygiene = { denylist: [], privateTerms: [] };

/** A literal secret string the private denylist would carry. */
const DENYLIST_HYGIENE: PublicationHygiene = { denylist: ["hunter2-legacy-passphrase"], privateTerms: [] };

/** The codes and lines of every finding, which is what most cases pin. */
function codesOf({ text, surface = "description" }: { text: string; surface?: "description" | "frame-text" }) {
  return publicationFindings({ hygiene: CLEAN_HYGIENE, surface, text }).map((finding) => [finding.code, finding.line]);
}

describe("scanPublication — first person", () => {
  it.each([["I"], ["me"], ["my"], ["we"], ["our"], ["us"], ["We"], ["OUR"], ["US"]])(
    "refuses %s as a whole word in prose",
    (word) => {
      const findings = publicationFindings({
        hygiene: CLEAN_HYGIENE,
        surface: "title",
        text: `fix: ${word} changed it`,
      });
      expect(findings).toEqual([
        {
          code: "FIRST_PERSON",
          line: 1,
          message: `PR title line 1: "${word}" is first person — name who acted — "the owner", or "an agent" for a session — or say what the change does`,
          surface: "title",
          word,
        },
      ]);
    },
  );

  it("refuses a contraction, which is still first person", () => {
    expect(codesOf({ text: "I'm sure we're done" })).toEqual([
      ["FIRST_PERSON", 1],
      ["FIRST_PERSON", 1],
    ]);
  });

  it("names the line a pronoun sits on in a multi-line text", () => {
    expect(codesOf({ text: "fix: the parser\n\nThe owner saw it.\nThen we fixed it." })).toEqual([["FIRST_PERSON", 4]]);
  });

  it.each([
    ["user", "the user sees a refusal"],
    ["museum", "a museum of old shapes"],
    ["macOS", "macOS, Keychain, Spotlight and APFS stay valid"],
    ["this machine", "it failed on this machine after consent"],
    ["a hyphenated compound", "a US-based region and us-east-1 in prose"],
    ["a path segment", "see docs/us/readme for the routing"],
    ["an abbreviation", "a reader, i.e. the owner, saw it"],
    ["an address", "the us.gov mirror"],
    ["an enumerator", "two cases: i) a refusal and ii) a hold"],
    ["I/O", "the I/O path stays bounded"],
    ["a handle", "the @us team"],
  ])("lets %s through", (_label, text) => {
    expect(codesOf({ text })).toEqual([]);
  });

  it("skips an inline code span, so `US` inside one is an identifier", () => {
    expect(codesOf({ text: "Set the region to `US` and the flag to `--me`." })).toEqual([]);
  });

  it("skips a fenced code block, whichever fence opens it", () => {
    const text = ["Before.", "```ts", "const we = our(me);", "```", "~~~", "I am code", "~~~", "After."].join("\n");
    expect(codesOf({ text })).toEqual([]);
  });

  it("resumes scanning after a fence closes", () => {
    expect(codesOf({ text: ["```", "we", "```", "we"].join("\n") })).toEqual([["FIRST_PERSON", 4]]);
  });

  it("skips a quoted owner sentence, straight or curly, and a blockquote", () => {
    const text = [
      'The owner asked: "I want risk above the fold."',
      "The owner said “we should lead with the number”.",
      "> I would rather see the evidence first.",
    ].join("\n");
    expect(codesOf({ text })).toEqual([]);
  });

  it("scans a GitHub alert block, which is authored prose under a marker", () => {
    expect(codesOf({ text: "> [!NOTE]\n> we changed the default" })).toEqual([["FIRST_PERSON", 2]]);
  });

  it("skips a link target but scans the link text", () => {
    expect(codesOf({ text: "See [the plan](https://example.test/we/our/us) for details." })).toEqual([]);
    expect(codesOf({ text: "See [what we decided](https://example.test/plan)." })).toEqual([["FIRST_PERSON", 1]]);
  });

  it("skips a bare URL and an autolink", () => {
    expect(codesOf({ text: "Docs at https://example.test/us/me and <https://example.test/we>." })).toEqual([]);
  });

  it("scans a hover title on an HTML tag, and skips the tag itself", () => {
    expect(codesOf({ text: '<img src="https://img.shields.io/badge/us-red" alt="risk badge">' })).toEqual([]);
    expect(codesOf({ text: '<img src="https://img.shields.io/x" title="Seen 16 Nov: we ran it">' })).toEqual([
      ["FIRST_PERSON", 1],
    ]);
  });

  it("skips a <code> element and an HTML comment", () => {
    expect(codesOf({ text: "Use <code>we --our</code> here. <!-- I wrote this -->" })).toEqual([]);
  });

  it("leaves wording rules off captured frame text, which quotes a screen", () => {
    expect(codesOf({ surface: "frame-text", text: "We think this Mac is fine" })).toEqual([]);
  });
});

describe("scanPublication — host wording", () => {
  it("refuses this Mac in prose, with the fix", () => {
    const findings = publicationFindings({
      hygiene: CLEAN_HYGIENE,
      surface: "commit-message",
      text: "fix: setup failed on this Mac",
    });
    expect(findings).toEqual([
      {
        code: "HOST_WORDING",
        line: 1,
        message: 'commit message line 1: "this Mac" names the host by its make — write "this machine"',
        surface: "commit-message",
      },
    ]);
  });

  it("matches across case and a line break", () => {
    expect(codesOf({ text: "ran on THIS\nmac twice" })).toEqual([["HOST_WORDING", 1]]);
  });

  it("lets this machine, macOS, Keychain, Spotlight, APFS and a MacBook model through", () => {
    expect(codesOf({ text: "this machine runs macOS; Keychain, Spotlight and APFS; this Macintosh guide" })).toEqual(
      [],
    );
  });

  it("skips this Mac quoted or in a code span", () => {
    expect(codesOf({ text: 'The rule refuses "this Mac" and `this Mac`.' })).toEqual([]);
  });
});

describe("scanPublication — installation state", () => {
  const SESSION = "0123abcd-4567-89ab-cdef-0123456789ab";

  it.each([
    ["transcript-pointer", `origin: transcript:${SESSION}#${SESSION}`],
    ["transcript-pointer", `talk-call:${SESSION}#turn_abc`],
    ["session-id", `the session ${SESSION} saw it`],
    ["session-id", `thread id: ${SESSION}`],
    ["observed-by", "observed by retry-loop-fix on 2026-01-02, no ask"],
    ["observed-by", "observed by `supervisor_seat`"],
    ["home-path", "read /Users/somebody/dev/repo/file.ts"],
    ["home-path", "under /home/someone/.config"],
    ["home-path", "the store at ~/.slopweaver/ledgers"],
    ["home-path", "the store at $HOME/.slopweaver"],
    ["machine-temp-path", "written to /var/folders/f_/abc/T/x.png"],
    ["machine-temp-path", "saved in /private/tmp/claude-501/scratch"],
  ])("refuses a %s, without echoing it", (kind, text) => {
    const findings = publicationFindings({ hygiene: CLEAN_HYGIENE, surface: "description", text });
    expect(findings).toEqual([
      { code: "INSTALLATION_STATE", kind, line: 1, message: expect.any(String), surface: "description" },
    ]);
    expect(findings[0]!.message.includes(SESSION)).toBe(false);
    expect(findings[0]!.message.includes("somebody")).toBe(false);
  });

  it("judges installation state inside a code span too, because a value identifies the install anywhere", () => {
    expect(codesOf({ text: `the file \`/Users/somebody/x.ts\` and \`transcript:${SESSION}#a\`` })).toEqual([
      ["INSTALLATION_STATE", 1],
      ["INSTALLATION_STATE", 1],
    ]);
  });

  it.each([
    ["the generic state-home spelling", "a 0600 file in `$SLOPWEAVER_HOME/secrets/`"],
    ["a placeholder home", "a path like /Users/<name>/dev"],
    ["observed by the owner", "the failure was observed by the owner"],
    ["a pointer placeholder", "the `transcript:<session>#<turn>` shape is gone"],
    ["a bare UUID nobody calls a session", `the fixture uuid ${SESSION}`],
  ])("lets %s through", (_label, text) => {
    expect(codesOf({ text })).toEqual([]);
  });

  it("applies to captured frame text, where wording rules do not", () => {
    expect(codesOf({ surface: "frame-text", text: "Finder: /Users/somebody/Desktop" })).toEqual([
      ["INSTALLATION_STATE", 1],
    ]);
  });

  it("names the fix for a home path", () => {
    const findings = publicationFindings({ hygiene: CLEAN_HYGIENE, surface: "image-caption", text: "~/.slopweaver" });
    expect(findings.map((finding) => finding.message)).toEqual([
      "image caption line 1: an absolute home path (redacted here) — write a repository-relative path, or `$SLOPWEAVER_HOME/<path>` for the state home",
    ]);
  });
});

describe("scanPublication — private terms", () => {
  const TERMS_HYGIENE: PublicationHygiene = {
    denylist: [],
    privateTerms: unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
    ),
  };

  it("maps a private term to the surface it was scanned as, quoted frame text included", () => {
    expect(publicationFindings({ hygiene: TERMS_HYGIENE, surface: "frame-text", text: "from Quillfeather" })).toEqual([
      {
        className: "person",
        code: "PRIVATE_TERM",
        line: 1,
        message:
          "captured frame text line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
        surface: "frame-text",
      },
    ]);
  });

  it("withholds every printed line a term equal to a word of the surface label matches, header included", () => {
    const hygiene: PublicationHygiene = {
      denylist: [],
      privateTerms: unwrap(parsePrivateTerms({ text: "class\tflags\tpattern\tsource\ntopic\ti\ttitle\tsynthetic\n" })),
    };
    const error = unwrapErr(scanPublication({ hygiene, surface: "title", text: "fix my build" }));
    expect(error.findings.map((finding) => finding.message)).toEqual([WITHHELD_REFUSAL_LINE]);
    expect(publicationRefusalLines({ error, subject: "PR #7" })[0]).toBe(
      `refused: PR #7 (${WITHHELD_REFUSAL_LINE}) cannot be published as written:`,
    );
    expect(error.message.includes("title")).toBe(false);
  });
});

describe("scanPublication — hygiene", () => {
  it("refuses a denylisted term without echoing it", () => {
    const findings = publicationFindings({
      hygiene: DENYLIST_HYGIENE,
      surface: "commit-message",
      text: "chore: rotate\n\nhunter2-legacy-passphrase is gone",
    });
    expect(findings).toEqual([
      {
        code: "HYGIENE",
        label: "denylist",
        line: 3,
        message: "commit message line 3: a denylisted term (redacted here) — remove it",
        surface: "commit-message",
      },
    ]);
  });

  it("refuses a credential shape with an empty denylist, inside a code span too", () => {
    const token = `ghp_${"a".repeat(30)}`;
    const findings = publicationFindings({ hygiene: CLEAN_HYGIENE, surface: "description", text: `\`${token}\`` });
    expect(findings).toEqual([
      {
        code: "HYGIENE",
        label: "github-oauth-token",
        line: 1,
        message: "PR description line 1: a github-oauth-token shape (redacted here) — remove it",
        surface: "description",
      },
    ]);
    expect(findings[0]!.message.includes(token)).toBe(false);
  });
});

describe("scanPublication — the Result and its rendering", () => {
  it("answers ok for text that may be published", () => {
    const result = scanPublication({
      hygiene: CLEAN_HYGIENE,
      surface: "self-review-comment",
      text: "⚠️ Start here: `reconcile.ts` runs before anything is written, so the owner sees no partial state.",
    });
    expect(result).toEqual(ok(undefined));
  });

  it("refuses with every finding, in line order, under the surface it was scanned as", () => {
    const error = unwrapErr(
      scanPublication({ hygiene: CLEAN_HYGIENE, surface: "description", text: "ok\non this Mac\nwe saw it" }),
    );
    expect(error.code).toBe("PUBLICATION_REFUSED");
    expect(error.surface).toBe("description");
    expect(error.findings.map((finding) => [finding.code, finding.line])).toEqual([
      ["HOST_WORDING", 2],
      ["FIRST_PERSON", 3],
    ]);
    expect(error.message).toBe(
      'PR description refused: PR description line 2: "this Mac" names the host by its make — write "this machine"; ' +
        'PR description line 3: "we" is first person — name who acted — "the owner", or "an agent" for a session — or say what the change does',
    );
  });

  it("renders refusal lines naming the subject, each finding and that there is no override", () => {
    const error = unwrapErr(
      scanPublication({ hygiene: CLEAN_HYGIENE, surface: "commit-message", text: "fix: my bad" }),
    );
    expect(publicationRefusalLines({ error, subject: "commit 1a2b3c4d5e6f" })).toEqual([
      "refused: commit 1a2b3c4d5e6f (commit message) cannot be published as written:",
      '  commit message line 1: "my" is first person — name who acted — "the owner", or "an agent" for a session — or say what the change does',
      "  This is a hold, with no override: reword the text, then run the command again.",
    ]);
  });

  it("labels every surface", () => {
    expect(
      (["title", "description", "self-review-comment", "commit-message", "image-caption", "frame-text"] as const).map(
        (surface) => publicationSurfaceLabel({ surface }),
      ),
    ).toEqual([
      "PR title",
      "PR description",
      "self-review comment",
      "commit message",
      "image caption",
      "captured frame text",
    ]);
  });

  it("answers ok for an empty text", () => {
    expect(scanPublication({ hygiene: CLEAN_HYGIENE, surface: "title", text: "" })).toEqual(ok(undefined));
  });
});
