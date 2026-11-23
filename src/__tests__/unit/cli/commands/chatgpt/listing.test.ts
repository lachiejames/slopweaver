/**
 * The account listing: path builders, the three strict boundaries, and the paced walk over all three lanes. Every body
 * here is synthetic, shaped like the measured answers (key set and value types, never a real value).
 */
import { describe, expect, it } from "vitest";

import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import {
  conversationsPagePath,
  listChatgptInventory,
  projectConversationsPagePath,
  projectsPagePath,
} from "../../../../../cli/commands/chatgpt/listing.js";
import {
  listedInstantIso,
  parseConversationsPage,
  parseProjectsPage,
} from "../../../../../cli/commands/chatgpt/listingPages.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

const PROJECT = "g-p-0123456789abcdef0123456789abcdef";

/** A conversation id whose last digits are `n`. */
function cid({ n }: { n: number }): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** One listed item, every measured key present. */
function item({ n, over = {} }: { n: number; over?: Record<string, unknown> }): Record<string, unknown> {
  return {
    async_status: null,
    blocked_urls: [],
    context_scopes: null,
    context_scopes_v2: { context_scopes: [] },
    conversation_origin: null,
    conversation_template_id: null,
    create_time: "2026-11-01T10:00:00.000000Z",
    current_node: null,
    gizmo_id: null,
    id: cid({ n }),
    is_archived: false,
    is_do_not_remember: false,
    is_starred: null,
    is_temporary_chat: false,
    latest_assistant_turn_created_at: null,
    mapping: null,
    memory_scope: "global_enabled",
    pinned_time: null,
    safe_urls: [],
    snippet: null,
    sugar_item_id: null,
    sugar_item_visible: false,
    summary_metadata: null,
    title: `Chat ${String(n)}`,
    trial_conversation_type: null,
    update_time: `2026-11-${String(10 + n).padStart(2, "0")}T10:00:00.123456Z`,
    workspace_id: null,
    ...over,
  };
}

/** One sidebar item naming one project, every measured key present. */
function projectItem({ id }: { id: string }): Record<string, unknown> {
  const gizmo: Record<string, unknown> = {};
  for (const key of [
    "appeal_info",
    "archived_at",
    "author",
    "context_stuffing_budget",
    "conversation_copy_in_progress",
    "created_at",
    "current_user_permission",
    "default_model",
    "gizmo_snorlax_type",
    "gizmo_type",
    "goal",
    "instructions",
    "is_archived",
    "is_unassigned",
    "last_interacted_at",
    "live_version",
    "memory_enabled",
    "memory_scope",
    "model",
    "num_interactions",
    "organization_id",
    "share_recipient",
    "sharing",
    "sharing_targets",
    "short_url",
    "tags",
    "training_disabled",
    "updated_at",
    "use_injest_path",
    "vanity_metrics",
    "version",
    "version_author",
    "version_created_at",
    "version_updated_at",
    "voice",
    "workspace_approval_date",
    "workspace_approved",
    "workspace_id",
  ]) {
    gizmo[key] = null;
  }
  return {
    conversations: { cursor: null, items: [] },
    gizmo: {
      files: [],
      gizmo: {
        ...gizmo,
        display: {
          categories: [],
          description: "",
          emoji: null,
          name: "Synthetic project",
          profile_pic_id: null,
          profile_picture_url: null,
          prompt_starters: [],
          theme: null,
        },
        id,
      },
      has_tpp_conversation: false,
      is_space_backing: false,
      product_features: {},
      project_connector_scope_limits: null,
      project_file_limits: null,
      tools: [],
    },
  };
}

/** A GET answering from a table of path → body, recording what was asked and refusing an unknown path. */
function fakeWeb({ bodies }: { bodies: Readonly<Record<string, unknown>> }): {
  asked: string[];
  paced: { count: number };
  deps: Parameters<typeof listChatgptInventory>[0]["deps"];
} {
  const asked: string[] = [];
  const paced = { count: 0 };
  return {
    asked,
    deps: {
      fetchText: ({ path }): Promise<Result<string, ChatgptError>> => {
        asked.push(path);
        const body = bodies[path];
        if (body === undefined) {
          return Promise.resolve(err(ChatgptErrors.httpRefused({ path, status: 404 })));
        }
        return Promise.resolve(ok(JSON.stringify(body)));
      },
      pacer: {
        beforeRequest: () => {
          paced.count += 1;
          return Promise.resolve();
        },
      },
    },
    paced,
  };
}

describe("listing paths", () => {
  it("builds each lane's path from constants and the page position only", () => {
    expect(conversationsPagePath({ archived: false, offset: 28 })).toBe(
      "/backend-api/conversations?offset=28&limit=28&order=updated",
    );
    expect(conversationsPagePath({ archived: true, offset: 0 })).toBe(
      "/backend-api/conversations?offset=0&limit=28&order=updated&is_archived=true",
    );
    expect(projectsPagePath({ cursor: null })).toBe(
      "/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0",
    );
    expect(projectsPagePath({ cursor: "a b/c" })).toBe(
      "/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&cursor=a%20b%2Fc",
    );
    expect(projectConversationsPagePath({ cursor: null, projectId: PROJECT })).toBe(
      `/backend-api/gizmos/${PROJECT}/conversations?cursor=0`,
    );
  });
});

describe("listedInstantIso", () => {
  it("reads the listing's microsecond ISO string to a millisecond instant, and refuses what does not parse", () => {
    expect(listedInstantIso({ text: "2026-11-17T12:34:56.789012Z" })).toBe("2026-11-17T12:34:56.789Z");
    expect(listedInstantIso({ text: "yesterday" })).toBeUndefined();
  });
});

describe("parseConversationsPage", () => {
  it("reads a measured page into listed conversations", () => {
    const page = unwrap(
      parseConversationsPage({
        archived: true,
        path: "/p",
        text: JSON.stringify({ items: [item({ n: 1 })], limit: 28, offset: 0, total: 1 }),
      }),
    );
    expect(page).toEqual({
      items: [
        {
          createdIso: "2026-11-01T10:00:00.000Z",
          id: cid({ n: 1 }),
          lane: "archived",
          projectId: null,
          title: "Chat 1",
          updatedIso: "2026-11-11T10:00:00.123Z",
        },
      ],
      total: 1,
    });
  });

  it("refuses a key the measurement never saw, by name", () => {
    const text = JSON.stringify({
      items: [item({ n: 1, over: { brand_new_flag: true } })],
      limit: 28,
      offset: 0,
      total: 1,
    });
    const refused = unwrapErr(parseConversationsPage({ archived: false, path: "/p", text }));
    expect(refused.code).toBe("PAGE_MALFORMED");
    expect(refused.message).toContain("brand_new_flag");
  });

  it("refuses an id that is not a conversation id, without quoting it", () => {
    const text = JSON.stringify({ items: [item({ n: 1, over: { id: "not-an-id" } })], limit: 28, offset: 0, total: 1 });
    const refused = unwrapErr(parseConversationsPage({ archived: false, path: "/p", text }));
    expect(refused.message).toBe(
      "GET /p answered JSON that is not a page of messages: a listed id is not a conversation id",
    );
  });
});

describe("parseProjectsPage", () => {
  it("reads each project's id and name, and refuses an id of another shape", () => {
    const page = unwrap(
      parseProjectsPage({ path: "/s", text: JSON.stringify({ cursor: null, items: [projectItem({ id: PROJECT })] }) }),
    );
    expect(page).toEqual({ cursor: null, projects: [{ id: PROJECT, name: "Synthetic project" }] });
    const bad = unwrapErr(
      parseProjectsPage({ path: "/s", text: JSON.stringify({ cursor: null, items: [projectItem({ id: "g-p-x" })] }) }),
    );
    expect(bad.message).toContain("not g-p- and 32 hex digits");
  });
});

describe("listChatgptInventory", () => {
  const active0 = conversationsPagePath({ archived: false, offset: 0 });
  const active1 = conversationsPagePath({ archived: false, offset: 2 });
  const archived0 = conversationsPagePath({ archived: true, offset: 0 });
  const sidebar0 = projectsPagePath({ cursor: null });
  const sidebar1 = projectsPagePath({ cursor: "next" });
  const project0 = projectConversationsPagePath({ cursor: null, projectId: PROJECT });

  it("walks every lane serially, every request paced, and lists a conversation two lanes name once", async () => {
    const web = fakeWeb({
      bodies: {
        [active0]: { items: [item({ n: 1 }), item({ n: 2 })], limit: 28, offset: 0, total: 3 },
        [active1]: { items: [item({ n: 3 })], limit: 28, offset: 2, total: 3 },
        [archived0]: { items: [item({ n: 4, over: { is_archived: true } })], limit: 28, offset: 0, total: 1 },
        [project0]: { cursor: null, items: [item({ n: 5, over: { gizmo_id: PROJECT } }), item({ n: 1 })] },
        [sidebar0]: { cursor: "next", items: [projectItem({ id: PROJECT })] },
        [sidebar1]: { cursor: null, items: [projectItem({ id: PROJECT })] },
      },
    });
    const inventory = unwrap(await listChatgptInventory({ deps: web.deps, maxPages: 10 }));
    expect(web.asked).toEqual([active0, active1, archived0, sidebar0, sidebar1, project0]);
    expect(web.paced.count).toBe(6);
    expect(inventory.requests).toBe(6);
    expect(inventory.conversations.map((one) => [one.id, one.lane, one.projectId])).toEqual([
      [cid({ n: 1 }), "active", null],
      [cid({ n: 2 }), "active", null],
      [cid({ n: 3 }), "active", null],
      [cid({ n: 4 }), "archived", null],
      [cid({ n: 5 }), "project", PROJECT],
    ]);
    expect(inventory.repeats).toBe(1);
    expect(inventory.projects).toEqual([{ id: PROJECT, name: "Synthetic project" }]);
  });

  it("stops at the first refusal and asks nothing after it", async () => {
    const web = fakeWeb({ bodies: { [active0]: { items: [item({ n: 1 })], limit: 28, offset: 0, total: 1 } } });
    const refused = unwrapErr(await listChatgptInventory({ deps: web.deps, maxPages: 10 }));
    expect(refused.code).toBe("HTTP_REFUSED");
    expect(web.asked).toEqual([active0, archived0]);
  });

  it("refuses an empty page short of the listing's own total rather than calling the lane whole", async () => {
    const web = fakeWeb({ bodies: { [active0]: { items: [], limit: 28, offset: 0, total: 5 } } });
    const refused = unwrapErr(await listChatgptInventory({ deps: web.deps, maxPages: 10 }));
    expect(refused.code).toBe("LISTING_STALLED");
    expect(refused.message).toBe(
      "the active listing did not move forward (an empty page at offset 0 of 5); stopped rather than loop",
    );
  });

  it("refuses a cursor handed back twice rather than loop", async () => {
    const web = fakeWeb({
      bodies: {
        [active0]: { items: [], limit: 28, offset: 0, total: 0 },
        [archived0]: { items: [], limit: 28, offset: 0, total: 0 },
        [sidebar0]: { cursor: "next", items: [] },
        [sidebar1]: { cursor: "next", items: [] },
      },
    });
    const refused = unwrapErr(await listChatgptInventory({ deps: web.deps, maxPages: 10 }));
    expect(refused.code).toBe("LISTING_STALLED");
    expect(web.asked).toEqual([active0, archived0, sidebar0, sidebar1]);
  });

  it("refuses a project's first page handing back cursor 0, the very URL it was asked on", async () => {
    const web = fakeWeb({
      bodies: {
        [active0]: { items: [], limit: 28, offset: 0, total: 0 },
        [archived0]: { items: [], limit: 28, offset: 0, total: 0 },
        [project0]: { cursor: 0, items: [item({ n: 1, over: { gizmo_id: PROJECT } })] },
        [sidebar0]: { cursor: null, items: [projectItem({ id: PROJECT })] },
      },
    });
    const refused = unwrapErr(await listChatgptInventory({ deps: web.deps, maxPages: 10 }));
    expect(refused.code).toBe("LISTING_STALLED");
    expect(web.asked).toEqual([active0, archived0, sidebar0, project0]);
  });

  it("refuses a lane that runs past the page bound", async () => {
    const web = fakeWeb({
      bodies: { [active0]: { items: [item({ n: 1 }), item({ n: 2 })], limit: 28, offset: 0, total: 9 } },
    });
    const refused = unwrapErr(await listChatgptInventory({ deps: web.deps, maxPages: 1 }));
    expect(refused.code).toBe("LISTING_BOUND_EXCEEDED");
    expect(web.asked).toEqual([active0]);
  });
});
