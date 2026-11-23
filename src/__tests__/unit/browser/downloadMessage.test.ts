import { describe, expect, it } from "vitest";
import { downloadMessage } from "../../../browser/downloadMessage.js";

describe("downloadMessage", () => {
  it("on a timeout with no name expected, says the click happened and nothing arrived at all", () => {
    const message = downloadMessage({ candidates: 0, directory: "/d", expected: undefined, names: [] });
    expect(message).toContain("the click WAS made and nothing matching arrived in /d.");
    expect(message).toContain("nothing here can tell those apart");
  });

  it("on a timeout under an expected name, never claims nothing downloaded", () => {
    const message = downloadMessage({ candidates: 0, directory: "/d", expected: "x.csv", names: [] });
    expect(message).toContain("arrived in /d under the name x.csv.");
    expect(message).toContain("this is not evidence that nothing downloaded");
  });

  it("on one file that could not be copied, names it and says not to re-run", () => {
    const message = downloadMessage({ candidates: 1, directory: "/d", expected: undefined, names: ["x.csv"] });
    expect(message).toContain("x.csv appeared in /d");
    expect(message).toContain("Do NOT re-run this command.");
  });

  it("on an ambiguity, lists every file and says the click was made once already", () => {
    const message = downloadMessage({ candidates: 2, directory: "/d", expected: undefined, names: ["a", "b"] });
    expect(message).toContain("2 new files settled in /d while it ran (a, b)");
    expect(message).toContain("the click has already been made once");
  });
});
