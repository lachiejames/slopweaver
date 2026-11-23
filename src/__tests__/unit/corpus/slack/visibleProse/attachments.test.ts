/*
 * How a message's attachments become prose: legacy slots and fields, nested and quoted blocks, and work-object
 * unfurls, read for their language while the icons, transport metadata and machine-token field values stay out.
 */
import { describe, expect, it } from "vitest";

import { flatten } from "./fixtures.js";

describe("flattenSlackVisibleProse — attachments", () => {
  it("reads an untyped legacy attachment's slots in a fixed order", () => {
    const raw = {
      attachments: [
        {
          author_name: "deploy-bot",
          fallback: "a plain restatement of the whole card",
          footer: "Deploy pipeline",
          pretext: "heads up",
          text: "the build finished in four minutes",
          title: "Build 4821 succeeded",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual([
      "heads up",
      "deploy-bot",
      "Build 4821 succeeded",
      "the build finished in four minutes",
      "Deploy pipeline",
    ]);
  });

  it("uses fallback only when the attachment yielded nothing richer", () => {
    const raw = { attachments: [{ fallback: "the only representation available" }] };
    expect(flatten({ raw })).toStrictEqual(["the only representation available"]);
  });

  it("reads attachment field titles and values", () => {
    const raw = { attachments: [{ fields: [{ title: "Environment", value: "production" }] }] };
    expect(flatten({ raw })).toStrictEqual(["Environment", "production"]);
  });

  it("reads blocks nested inside an attachment", () => {
    const raw = {
      attachments: [{ blocks: [{ text: { text: "nested inside the attachment", type: "mrkdwn" }, type: "section" }] }],
    };
    expect(flatten({ raw })).toStrictEqual(["nested inside the attachment"]);
  });

  it("reads message_blocks through its two intermediate keys", () => {
    const raw = {
      attachments: [
        {
          message_blocks: [
            {
              message: { blocks: [{ text: { text: "quoted from another message", type: "mrkdwn" }, type: "section" }] },
            },
          ],
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["quoted from another message"]);
  });
});

describe("flattenSlackVisibleProse — work-object unfurls", () => {
  const workObject = {
    attachments: [
      {
        children: [
          {
            work_object_entity: {
              app_icons: { image_128: { alt_text: "the app icon", fallback: "icon fallback text" } },
              layouts: {
                expanded: {
                  actions: { block_payload: { service_id: "SERVICE_ID_VALUE" } },
                  fields: {
                    elements: [
                      { image: [{ alt_text: "an avatar image", fallback: "avatar fallback" }], label: "Assignee" },
                    ],
                  },
                  header_title: { text: "Linear" },
                  hover_subtitle: { text: "opened 3 days ago" },
                  product_icon: { alt_text: "the product icon", fallback: "product icon fallback" },
                  subtitle: { text: "in progress, assigned to Grace" },
                  title: { text: "ABC-123 fix the corpus projection" },
                },
              },
            },
          },
        ],
      },
    ],
  };

  it("reads the four prose slots and the field labels, in order", () => {
    expect(flatten({ raw: workObject })).toStrictEqual([
      "Linear",
      "ABC-123 fix the corpus projection",
      "in progress, assigned to Grace",
      "opened 3 days ago",
      "Assignee",
    ]);
  });

  it("indexes none of the icon or transport metadata in the same subtree", () => {
    const joined = flatten({ raw: workObject }).join(" ");
    expect(joined.includes("icon")).toBe(false);
    expect(joined.includes("fallback")).toBe(false);
    expect(joined.includes("SERVICE_ID_VALUE")).toBe(false);
    expect(joined.includes("avatar")).toBe(false);
  });
});

describe("flattenSlackVisibleProse — findings from the adversarial review", () => {
  it("drops an action-shaped attachment field's value, which is a machine token not prose", () => {
    const raw = {
      attachments: [{ fields: [{ action_id: "approve", type: "button", value: "opaque-machine-token" }] }],
    };
    expect(flatten({ raw })).toStrictEqual([]);
  });

  it("still reads a legacy field's value, which carries no action id", () => {
    const raw = { attachments: [{ fields: [{ title: "Environment", value: "production" }] }] };
    expect(flatten({ raw })).toStrictEqual(["Environment", "production"]);
  });
});
