/*
 * `stackLocalFacts`: the toplevel read from cwd and the named remote read from that root, an HTTPS remote
 * accepted beside an SCP-style one, and a remote URL that does not name exactly owner/name refused.
 */
import { describe, expect, it } from "vitest";

import { stackLocalFacts } from "../../../../../../cli/commands/github/stackFacts.js";
import { gitFake } from "./harness.js";

describe("stackLocalFacts", () => {
  it("reads the toplevel from cwd, then the named remote from that root", () => {
    const { git, reads } = gitFake({
      answers: [
        ["/cwd-echo :: rev-parse --show-toplevel", "/repo-alpha"],
        ["/repo-alpha :: remote get-url upstream-delta", "git@example.invalid:owner-bravo/repo-charlie.git"],
      ],
    });

    const result = stackLocalFacts({ cwd: "/cwd-echo", git, remote: "upstream-delta" });

    expect(result).toEqual({ repo: "owner-bravo/repo-charlie", repoRoot: "/repo-alpha" });
    expect(reads).toEqual([
      { args: ["rev-parse", "--show-toplevel"], cwd: "/cwd-echo" },
      { args: ["remote", "get-url", "upstream-delta"], cwd: "/repo-alpha" },
    ]);
  });

  // An HTTPS remote is accepted too, so validity is never read off the transport's spelling.
  it("accepts an HTTPS remote naming owner/name as well as an SCP-style one", () => {
    const { git } = gitFake({
      answers: [
        ["/cwd-lima :: rev-parse --show-toplevel", "/repo-mike"],
        ["/repo-mike :: remote get-url upstream-november", "https://example.invalid/owner-oscar/repo-papa.git"],
      ],
    });

    const result = stackLocalFacts({ cwd: "/cwd-lima", git, remote: "upstream-november" });

    expect(result).toEqual({ repo: "owner-oscar/repo-papa", repoRoot: "/repo-mike" });
  });

  it("refuses a remote URL that does not name exactly owner/name", () => {
    const { git } = gitFake({
      answers: [
        ["/cwd-golf :: rev-parse --show-toplevel", "/repo-hotel"],
        [
          "/repo-hotel :: remote get-url upstream-foxtrot",
          "https://example.invalid/group-india/sub-juliet/repo-kilo.git",
        ],
      ],
    });

    expect(() => stackLocalFacts({ cwd: "/cwd-golf", git, remote: "upstream-foxtrot" })).toThrow(
      new Error("remote upstream-foxtrot is not an owner/name Git repository URL"),
    );
  });
});
