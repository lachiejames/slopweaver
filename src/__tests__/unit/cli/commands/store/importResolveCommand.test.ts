/**
 * The one `store import-resolve` command every import verb prints: it always names the home the verb used, made
 * absolute, and a token a shell would split is quoted. Pure.
 */
import { describe, expect, it } from "vitest";

import { importResolveCommand, printedHome } from "../../../../../cli/commands/store/importResolveCommand.js";

describe("importResolveCommand", () => {
  it("names the home bare when it is shell-safe", () => {
    expect(
      importResolveCommand({ action: "keep-current", home: "/tmp/acme-home", questionId: "import-q-0123456789abcdef" }),
    ).toBe(
      "slopweaver store import-resolve --question import-q-0123456789abcdef --action keep-current --home /tmp/acme-home",
    );
  });

  it("quotes a home a shell would split or unquote", () => {
    expect(
      importResolveCommand({
        action: "leave-inactive",
        home: "/tmp/acme's home",
        questionId: "import-q-0123456789abcdef",
      }),
    ).toBe(
      "slopweaver store import-resolve --question import-q-0123456789abcdef --action leave-inactive --home '/tmp/acme'\\''s home'",
    );
  });
});

describe("printedHome", () => {
  it("makes a relative home absolute against the directory the verb ran in, so the line pastes anywhere", () => {
    expect(printedHome({ cwd: "/tmp/acme-work", home: "stores/acme-home" })).toBe("/tmp/acme-work/stores/acme-home");
  });

  it("keeps an absolute home, the user's default one included, since a pasting shell may select another", () => {
    expect([
      printedHome({ cwd: "/tmp/acme-work", home: "/tmp/acme-home" }),
      printedHome({ cwd: "/tmp/acme-work", home: "/Users/acme/.slopweaver" }),
    ]).toEqual(["/tmp/acme-home", "/Users/acme/.slopweaver"]);
  });
});
