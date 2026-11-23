/** How a killed pre-push gate or Git write names the signal that ended it. */
import { describe, expect, it } from "vitest";

import { killingSignalName } from "../../../admit/gitTransport.js";

describe("killingSignalName", () => {
  it("names the signal Node reported", () => {
    expect(killingSignalName({ result: { signal: "SIGPIPE" } })).toBe("SIGPIPE");
  });

  it("says an unnamed signal when Node reported none", () => {
    expect(killingSignalName({ result: { signal: null } })).toBe("an unnamed signal");
  });
});
