/**
 * The `spend` noun's manifest: six verbs. `import` writes only under the home, `merchants set` replaces the
 * install's card-merchant register in its own store, and `read` writes nothing;
 * `capture` reads the owner's Airwallex console through the browser relay, which is the door for a verb driving
 * their Chrome, and writes only the relay's scratch under the home; `tasks` reads the owner's mailbox through the Gmail door's
 * read functions and saves a matched receipt's PDFs under the home; `forward` writes a draft into the owner's own Gmail
 * through the door, the one verb here that does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SPEND_CAPTURE_USAGE,
  SPEND_FORWARD_USAGE,
  SPEND_IMPORT_USAGE,
  SPEND_MERCHANTS_USAGE,
  SPEND_READ_USAGE,
  SPEND_TASKS_USAGE,
} from "../../../../cli/commands/spend/usage.js";
import { spendManifest } from "../../../../cli/manifests/spend.js";

/** The manifest's own source, read so the eager-import property is checked on what ships. */
const MANIFEST_SOURCE = readFileSync(join(import.meta.dirname, "../../../../cli/manifests/spend.ts"), "utf8");

describe("spendManifest", () => {
  it("declares exactly the capture, forward, import, merchants, read and tasks verbs", () => {
    expect(Object.keys(spendManifest)).toEqual(["capture", "forward", "import", "merchants", "read", "tasks"]);
  });

  it("writes only local state on capture, import, merchants and tasks and nothing on read, and route only forward through the door", () => {
    expect(spendManifest["capture"]!.meta.effect).toBe("local-state");
    expect(spendManifest["import"]!.meta.effect).toBe("local-state");
    expect(spendManifest["merchants"]!.meta.effect).toBe("local-state");
    expect(spendManifest["read"]!.meta.effect).toBe("none");
    expect(spendManifest["tasks"]!.meta.effect).toBe("local-state");
    expect(Object.values(spendManifest).filter((entry) => entry.meta.doorRouted)).toEqual([spendManifest["forward"]]);
    expect(spendManifest["forward"]!.meta.effect).toBe("external-write");
  });

  it("quotes the usage leaf itself, so the manifest and --help cannot drift", () => {
    expect(spendManifest["capture"]!.meta.usage).toBe(SPEND_CAPTURE_USAGE);
    expect(spendManifest["import"]!.meta.usage).toBe(SPEND_IMPORT_USAGE);
    expect(spendManifest["read"]!.meta.usage).toBe(SPEND_READ_USAGE);
    expect(spendManifest["tasks"]!.meta.usage).toBe(SPEND_TASKS_USAGE);
    expect(spendManifest["forward"]!.meta.usage).toBe(SPEND_FORWARD_USAGE);
    expect(spendManifest["merchants"]!.meta.usage).toBe(SPEND_MERCHANTS_USAGE);
  });

  it("imports its usage from the leaf and never from the command module", () => {
    expect(MANIFEST_SOURCE).toContain('from "../commands/spend/usage.js"');
    expect(MANIFEST_SOURCE).not.toContain('from "../commands/spend/core.js"');
  });
});
