/**
 * `scheduledCardPostArgv` — the one post leg both card kinds send through since owner turn 291-8x.
 *
 * The assertions are on the WHOLE argv rather than on a flag at a time, because the thing this module
 * exists to hold still is that both kinds send the same words in the same order; a case that only probed
 * for `--idempotency-key` would pass over a leg that had quietly lost `--as bot`.
 *
 * Pure: strings in, strings out.
 */
import { describe, expect, it } from "vitest";

import { scheduledCardPostArgv } from "../../../../live/automation/cardPostArgv.js";

const BASE = {
  dmPurpose: "investigation-finding",
  dryRun: false,
  form: '{"kind":"update"}',
  home: "/tmp/home",
  idempotencyKey: "recipe-slot:abc123",
  media: [],
  postTo: "D0BOT",
} as const;

describe("scheduledCardPostArgv", () => {
  it("sends the card to the admitted conversation, as the bot, under the firing's own delivery key", () => {
    expect(scheduledCardPostArgv(BASE)).toEqual([
      "node",
      "slopweaver",
      "slack",
      "post",
      "--as",
      "bot",
      "--channel",
      "D0BOT",
      "--form",
      '{"kind":"update"}',
      "--home",
      "/tmp/home",
      "--idempotency-key",
      "recipe-slot:abc123",
      "--dm-purpose",
      "investigation-finding",
    ]);
  });

  it("declares the purpose the kind gives, so a report the owner asked for is not sent as a finding", () => {
    const argv = scheduledCardPostArgv({ ...BASE, dmPurpose: "asked-for" });
    expect(argv.slice(14, 16)).toEqual(["--dm-purpose", "asked-for"]);
  });

  it("appends every capture as one comma-joined --media word", () => {
    expect(scheduledCardPostArgv({ ...BASE, media: ["/tmp/a.png", "/tmp/b.png"] }).slice(-2)).toEqual([
      "--media",
      "/tmp/a.png,/tmp/b.png",
    ]);
  });

  it("carries --dry-run last, so the rendered argv is the real one plus a withheld wire", () => {
    const argv = scheduledCardPostArgv({ ...BASE, dryRun: true });
    expect(argv[argv.length - 1]).toBe("--dry-run");
    expect(argv.length).toBe(17);
  });

  it("passes the form as ONE word, whatever is in it", () => {
    const argv = scheduledCardPostArgv({ ...BASE, form: '{"body":"a b --channel C1"}' });
    expect(argv[9]).toBe('{"body":"a b --channel C1"}');
    expect(argv.filter((word) => word === "--channel").length).toBe(1);
  });
});
