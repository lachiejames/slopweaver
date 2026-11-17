/**
 * Every operation slopweaver calls, mapped to its endpoint class EXACTLY — the data half of `./rateLimits.ts`.
 *
 * Its own module because it is a TABLE, and the file it came out of is a set of functions that read tables.
 * It grew to more than half of `rateLimits.ts` and took that file past the `file-size-ratchet` floor, and a
 * row per call site is exactly what `operation-labels` requires, so this table only ever gets longer.
 * `rateLimits.ts` re-exports it, so no caller and no gate changed.
 */

/**
 * Every operation slopweaver calls, mapped to its endpoint class EXACTLY.
 *
 * Exact keys rather than substring or prefix matching, because a prefix rule is how `chat.postMessage`
 * silently inherits `chat.update`'s tier — and those two differ in both quota and reversibility. An
 * operation absent from this map is paced at its provider's `fallbackClass`, which is deliberately the
 * tightest one, so forgetting to add a new call site here is slow rather than dangerous.
 */
export const OPERATION_ENDPOINT_CLASS: Readonly<Record<string, string>> = {
  // GitHub, Linear and Notion each publish ONE quota rather than a per-method tier, so every one of these
  // maps to that provider's single class. Listing them anyway is not ceremony: `operation-labels` (the
  // dev-lint gate) requires an explicit entry for every label in the tree, so the day a provider gains a
  // second class, the labels that need re-classifying are already enumerated here instead of silently
  // inheriting `fallbackClass`.
  // The JumpCloud atlas's two origins. Two labels rather than one per surface: the registry holds 503 rows
  // and `operation-labels` requires an exact map entry for every label in the tree, so a per-surface label
  // would be 500 rows of the same class. Both wear the single `read` class this atlas has — it issues no
  // writes, so a `write` class would be a label with nothing to wear it.
  // The one Fathom operation this program makes. It wears `heavy` rather than `read` because it asks for
  // transcripts inline, which is exactly what Fathom's heavy class is defined over.
  "fathom.meetings.list": "heavy",
  "jumpcloud.directory.read": "read",
  "jumpcloud.insights.read": "read",
  "github.actions.getAllowedActionsRepository": "read",
  "github.actions.getForkPrContributorApprovalPermissionsRepository": "read",
  "github.actions.getGithubActionsDefaultWorkflowPermissionsRepository": "read",
  "github.actions.getGithubActionsPermissionsRepository": "read",
  "github.actions.getWorkflowRun": "read",
  "github.actions.listSelfHostedRunnersForRepo": "read",
  "github.actions.listWorkflowRunsForRepo": "read",
  "github.actions.reRunWorkflowFailedJobs": "write",
  "github.actions.setAllowedActionsRepository": "write",
  "github.actions.setForkPrContributorApprovalPermissionsRepository": "write",
  "github.actions.setGithubActionsDefaultWorkflowPermissionsRepository": "write",
  "github.actions.setGithubActionsPermissionsRepository": "write",
  // Every call the GitHub ATLAS makes, under one label: they are all GETs of one class, and the route is
  // carried by the typed error rather than by the label.
  "github.atlas.read": "read",
  // `github exposure`: every GET of its closed call table under one label, and its one GraphQL query.
  "github.exposure.graphql": "read",
  "github.exposure.rest": "read",
  "github.addPullRequestReview+resolveReviewThread": "write",
  "github.addPullRequestReviewThreadReply+resolveReviewThread": "write",
  // `github push-restriction`: the classic rules read, the login-to-node-id read, and the one GraphQL mutation.
  "github.branchProtectionRules": "read",
  "github.user": "read",
  "github.updateBranchProtectionRule": "write",
  "github.codeScanning.getAlert": "read",
  "github.codeScanning.getDefaultSetup": "read",
  "github.codeScanning.listAlertsForRepo": "read",
  "github.codeScanning.updateAlert": "write",
  "github.codeScanning.updateDefaultSetup": "write",
  "github.codeSecurity.getConfigurationForRepository": "read",
  "github.convertPullRequestToDraft": "write",
  "github.dependabot.getAlert": "read",
  "github.dependabot.listAlertsForRepo": "read",
  "github.dequeuePullRequest": "write",
  "github.enqueuePullRequest": "write",
  "github.enqueueStackPullRequest": "write",
  "github.git.createRef": "write",
  "github.git.getCommit": "read",
  "github.git.getRef": "read",
  "github.graphql.activity": "read",
  "github.graphql.discussions": "read",
  "github.graphql.namedObjectRead": "read",
  "github.rest.namedObjectRead": "read",
  // `github run-log`'s three REST reads and the one blob fetch behind them. The blob call leaves api.github.com
  // for the signed log host, which publishes no quota of its own, so it wears the same `read` class rather
  // than a class invented for one endpoint — it is still one GET per job, paced with everything else.
  "github.rest.actionsRunRead": "read",
  "github.rest.actionsRunJobsRead": "read",
  "github.rest.actionsJobLogRedirect": "read",
  // A body attachment fetched from its signed address on the attachment host, not the API: a read, never paced.
  "github.media.download": "read",
  "github.blob.actionsJobLogStream": "read",
  "github.graphql.saml": "read",
  "github.graphql.updateRefs": "write",
  "github.graphql.samlIdentities": "read",
  "github.issues.addLabels": "write",
  "github.issues.createComment": "write",
  "github.issues.createLabel": "write",
  "github.issues.get": "read",
  "github.issues.getComment": "read",
  "github.issues.getLabel": "read",
  "github.issues.listComments": "read",
  "github.issues.listForRepo": "read",
  "github.issues.listLabelsForRepo": "read",
  "github.issues.listMilestones": "read",
  "github.issues.updateComment": "write",
  "github.markPullRequestReadyForReview": "write",
  "github.orgs.get": "read",
  "github.orgs.listMembers": "read",
  "github.orgs.listRepos": "read",
  "github.pullRequest.introducedFilesFromTrees": "read",
  "github.pullRequest.mergeQueueEntry": "read",
  "github.pullRequest.reviewThreadDetails": "read",
  "github.pullRequest.reviewThreads": "read",
  "github.pulls.create": "write",
  "github.pulls.createReview": "write",
  "github.pulls.get": "read",
  "github.pulls.getReview": "read",
  "github.pulls.list": "read",
  "github.pulls.listFiles": "read",
  "github.pulls.listRequestedReviewers": "read",
  "github.pulls.listReviews": "read",
  "github.pulls.merge": "write",
  "github.pulls.requestReviewers": "write",
  "github.pulls.update": "write",
  "github.repos.checkPrivateVulnerabilityReporting": "read",
  "github.repos.checkVulnerabilityAlerts": "read",
  "github.repos.createCommitStatus": "write",
  "github.repos.createForAuthenticatedUser": "write",
  "github.repos.createInOrg": "write",
  "github.repos.disablePrivateVulnerabilityReporting": "write",
  "github.repos.disableVulnerabilityAlerts": "write",
  "github.repos.enablePrivateVulnerabilityReporting": "write",
  "github.repos.enableVulnerabilityAlerts": "write",
  "github.repos.get": "read",
  "github.repos.getAllTopics": "read",
  "github.repos.getCombinedStatusForRef": "read",
  "github.repos.getBranchProtection": "read",
  "github.repos.getStatusChecksProtection": "read",
  "github.repos.getContent": "read",
  "github.repos.listForOrg": "read",
  "github.repos.listReleases": "read",
  "github.repos.replaceAllTopics": "write",
  "github.repos.transfer": "write",
  "github.repos.update": "write",
  "github.repos.updateBranchProtection": "write",
  "github.repos.updateStatusCheckProtection": "write",
  "github.reviewThread.comments": "read",
  "github.search.issuesAndPullRequests": "read",
  "github.stacks.add": "write",
  "github.stacks.create": "write",
  "github.stacks.get": "read",
  "github.stacks.unstack": "write",
  "github.teams.list": "read",
  "github.teams.listMembersInOrg": "read",
  "github.teams.listReposInOrg": "read",
  "github.unresolveReviewThread": "write",
  "github.users.getAuthenticated": "read",
  "github.users.getByUsername": "read",
  // Google Drive. The two `oauth.*` labels are Google's identity endpoints rather than the Drive API, and
  // they are metered by nothing this registry can cite — so they take the tightest class, per the note on
  // `drive.fallbackClass`. `files.export` is a read: it renders a document Google already holds.
  // Google Calendar. `oauth.*` is Google's identity endpoint rather than the Calendar API; it takes the
  // same class as everything else here because this provider has only one.
  "calendar.calendarList.list": "read",
  "calendar.events.delete": "read",
  "calendar.events.get": "read",
  "calendar.events.insert": "read",
  "calendar.events.list": "read",
  "calendar.events.patch": "read",
  "calendar.freebusy.query": "read",
  "calendar.oauth.tokenExchange": "read",
  "calendar.oauth.userinfo": "read",
  "calendar.settings.get": "read",
  "drive.drives.list": "read",
  "drive.files.export": "read",
  "drive.files.get": "read",
  "drive.files.list": "read",
  "drive.oauth.tokenExchange": "write",
  "drive.oauth.userinfo": "write",
  // Gmail. The two `oauth.*` labels are Google's identity endpoints rather than the Gmail API, and they
  // are metered by nothing this registry can cite — so they take the tightest class, per the note on
  // `gmail.fallbackClass`.
  "gmail.docs.documents.get": "read",
  // The two Google Admin identity endpoints. `read` rather than the `write` its Drive and Gmail siblings
  // carry, and the difference is not a downgrade: those providers HAVE a tighter write class to point at,
  // and this one does not, because every scope it can request is readonly. Naming a class this provider
  // does not declare would leave the label resolving through the fallback anyway, while reading as though
  // a separate quota existed.
  // Every registry-driven Admin API call carries ONE label rather than forty. This provider declares a
  // single class, so a label per method would be forty rows all resolving to the same quota — and each one
  // would be a row nobody could keep in step with a regenerated registry.
  "google-admin.api.read": "read",
  "google-admin.directory.users.list": "read",
  "google-admin.oauth.tokenExchange": "read",
  "google-admin.oauth.userinfo": "read",
  // The SecOps door's one label for every Chronicle GET, for the Admin door's reason above.
  "google-secops.api.read": "read",
  "google-secops.oauth.tokenExchange": "read",
  "google-secops.oauth.userinfo": "read",
  // The KnowBe4 door's one label for every Reporting API GET — its transport sends nothing else.
  "knowbe4.api.read": "read",
  // The Knock door's five operations, each on the tier its OpenAPI document marks (`x-ratelimit-tier`): the
  // message lists and a single-message read Tier 4, a message's events and delivery logs Tier 3. GETs only.
  "knock.message.deliveryLogs.list": "tier3",
  "knock.message.events.list": "tier3",
  "knock.message.read": "tier4",
  "knock.messages.list": "tier4",
  "knock.users.messages.list": "tier4",
  // The Twilio door's one label for every Messages GET — its transport sends nothing else.
  "twilio.api.read": "read",
  "gmail.oauth.tokenExchange": "write",
  "gmail.oauth.userinfo": "write",
  // The Google DOCS call, deliberately labelled under `gmail`: it runs on the Gmail grant and the Gmail
  // rate scope and is only ever reached from the mail lane (`src/live/gmail/docs.ts`), and the label's
  // first segment names the provider whose classes it is checked against. A document read is a read.
  "gmail.users.drafts.create": "write",
  "gmail.users.drafts.get": "read",
  "gmail.users.drafts.send": "write",
  "gmail.users.getProfile": "read",
  // `history.list` costs 2 quota units — cheaper than the 5-unit read this class is priced on, so pacing it
  // as a read is the conservative direction, the same choice `labels.list` (1 unit) already made above.
  "gmail.users.history.list": "read",
  "gmail.users.labels.list": "read",
  "gmail.users.messages.attachments.get": "read",
  "gmail.users.messages.get": "read",
  "gmail.users.messages.list": "read",
  "gmail.users.messages.modify": "write",
  "gmail.users.threads.get": "read",
  "gmail.users.threads.modify": "write",
  // An asset GET is not GraphQL, but it presents the same per-user key to a host that refuses it without
  // one — so it plausibly spends the same per-user budget and is paced as a read. Contrast the upload PUT
  // in `../corpus/linear/writeAssets.ts`, which is unlabelled BECAUSE its presigned URL carries no key at
  // all and is a storage host rather than Linear's API.
  "linear.asset.download": "read",
  "linear.issue.readBack": "read",
  // The three mutation labels. Each is its own literal rather than one `linear.mutate`, because the retry
  // posture differs by reversibility: a create is irreversible and must never be retried after an ambiguous
  // response, whereas a read-back is safe to repeat. One label could not express that difference.
  "linear.issueCreate": "write",
  "linear.issueDelete": "write",
  "linear.issueUpdate": "write",
  "linear.rawRequest": "read",
  // `gmail unsubscribe`'s RFC 8058 POST, to whichever sender published the target: no provider owns the quota,
  // and it is one request per message a person chose, so it is never paced beyond that.
  "mail-sender.unsubscribe.one-click": "write",
  // The Make door's one label for every read (`src/atlas/make/client.ts`), for the Admin door's reason above:
  // its rail lets no method but GET out, and Make meters all of them against one per-organisation quota.
  "make.api.read": "read",
  "notion.blocks.children.append": "write",
  "notion.blocks.children.mediaAttach": "read",
  "notion.blocks.children.attachments": "read",
  "notion.blocks.children.list": "read",
  "notion.blocks.children.namedObjectRead": "read",
  "notion.blocks.delete": "write",
  "notion.blocks.retrieve": "read",
  "notion.comments.list": "read",
  "notion.databases.retrieve.namedObjectRead": "read",
  "notion.dataSources.query": "read",
  "notion.dataSources.retrieve": "read",
  "notion.files.download": "read",
  "notion.files.probe": "read",
  "notion.fileUploads.create": "write",
  "notion.fileUploads.retrieve": "read",
  "notion.fileUploads.send": "write",
  "notion.pages.create": "write",
  "notion.pages.move": "write",
  "notion.pages.retrieve.childPage": "read",
  "notion.pages.retrieve.namedObjectRead": "read",
  "notion.pages.retrieve.write": "read",
  "notion.pages.retrieveMarkdown": "read",
  "notion.pages.update": "write",
  "notion.pages.updateMarkdown": "write",
  "notion.search": "read",
  "notion.search.databases": "read",
  "notion.search.dataSources": "read",
  "notion.search.pages": "read",
  "notion.users.list": "read",
  "notion.users.me": "read",
  "outlook.attachments.get": "read",
  "outlook.attachments.list": "read",
  "outlook.calendar.calendars.list": "read",
  "outlook.calendar.events.get": "read",
  "outlook.calendar.events.list": "read",
  "outlook.calendar.view.list": "read",
  "outlook.categories.list": "read",
  "outlook.drafts.create": "write",
  "outlook.drafts.createReply": "write",
  "outlook.drafts.get": "read",
  "outlook.drafts.patch": "write",
  "outlook.drafts.send": "write",
  "outlook.folders.get": "read",
  "outlook.folders.list": "read",
  "outlook.me.get": "read",
  "outlook.messages.delta": "read",
  "outlook.messages.get": "read",
  "outlook.messages.list": "read",
  "outlook.messages.move": "write",
  "outlook.messages.patch": "write",
  "outlook.messages.search": "read",
  "outlook.messages.thread": "read",
  // The three MSAL calls reach the Microsoft identity platform, not Graph. Its token endpoint publishes no
  // per-user quota, so they take the write class, the door's tightest, as the Google token exchange does.
  "outlook.msal.acquireTokenByCode": "write",
  "outlook.msal.acquireTokenSilent": "write",
  "outlook.msal.getAuthCodeUrl": "write",
  // Socket Mode's connection ticket. Slack's published method-tier table does not classify it, so rather
  // than invent a quota it takes the provider's tightest documented class — the conservative direction, and
  // harmless in practice because a listener opens one ticket per connection, not one per event. `tier1` is
  // not in `PACED_CLASSES` today, so the label buys the shared 429 block rather than a throttle.
  "slack.apps.connections.open": "tier1",
  // The native thinking indicator. Its OWN class — see the registry entry above for why `chat-post` and the
  // generic tiers are both wrong here (Slack documents a distinct 600/minute allowance for this method).
  "slack.assistant.threads.setStatus": "assistant-status",
  // Naming an agent thread. "Tier 4: 100+ per minute" per Slack's published table for the method —
  // a real documented tier, not a conservative guess, and one call per turn regardless.
  "slack.assistant.threads.setTitle": "tier4",
  "slack.auth.test": "tier4",
  // The two write-lane preflights. Static literals rather than the `slack.auth.test.write.${lane}` template
  // they replaced: a template cannot be checked against this map by any static gate, and an unmapped Slack
  // label falls back to `tier1` — a 75-SECOND interval the moment that class is ever paced.
  "slack.auth.test.write.bot": "tier4",
  "slack.auth.test.write.user": "tier4",
  "slack.bookmarks.list": "tier3",
  // The CANVAS lane. Every tier here is transcribed from that method's own page on docs.slack.dev —
  // `canvases.create` and `conversations.canvases.create` are "Tier 2: 20+ per minute",
  // `canvases.edit` and `canvases.delete` are "Tier 3: 50+ per minute". They are NOT one class: the two
  // creates are the tighter pair, which is the opposite of the intuition that a destructive delete would be.
  "slack.canvases.create": "tier2",
  "slack.canvases.delete": "tier3",
  "slack.canvases.edit": "tier3",
  // Generic stream transport calls. "Tier 2: 20+ per minute" for start/stop, "Tier 4: 100+ per minute" for
  // append, per Slack's published method-tier table — real documented tiers.
  "slack.chat.appendStream": "tier4",
  "slack.chat.delete": "tier3",
  "slack.chat.postMessage": "chat-post",
  "slack.chat.postMessage.assistant": "chat-post",
  "slack.chat.postMessage.drip": "chat-post",
  "slack.chat.postMessage.noFold": "chat-post",
  "slack.chat.postMessage.poll": "chat-post",
  "slack.chat.postMessage.progress": "chat-post",
  "slack.chat.postMessage.recipeResponse": "chat-post",
  "slack.chat.postMessage.turn": "chat-post",
  "slack.chat.startStream": "tier2",
  "slack.chat.stopStream": "tier2",
  "slack.chat.update": "tier3",
  "slack.chat.update.assistant": "tier3",
  "slack.chat.update.correction": "tier3",
  "slack.chat.update.drip": "tier3",
  "slack.chat.update.progress": "tier3",
  "slack.chat.update.recipeResponse": "tier3",
  "slack.chat.update.turn": "tier3",
  // The workspace-SHAPE lane, each tier transcribed from that method's own page on docs.slack.dev:
  // `conversations.create`, `setPurpose`, `setTopic`, `archive` and the channel canvas are
  // "Tier 2: 20+ per minute", while `open` and `invite` are "Tier 3: 50+ per minute". Every one of them is
  // a one-shot interactive call rather than a loop, so the classification buys the shared 429 block and the
  // right pacing class rather than changing how any of them feels to run.
  "slack.conversations.archive": "tier2",
  "slack.conversations.canvases.create": "tier2",
  "slack.conversations.create": "tier2",
  "slack.conversations.history": "tier3",
  // Reading a channel's KIND, so a poll's footer can tell the truth about who sees a vote. Tier 3.
  "slack.conversations.info": "tier3",
  "slack.conversations.invite": "tier3",
  // Joining a public channel as the token's own account, before an approved as-me release posts into it.
  // "Tier 3: 50+ per minute" on its docs.slack.dev page.
  "slack.conversations.join": "tier3",
  "slack.conversations.list": "tier2",
  "slack.conversations.members": "tier4",
  "slack.conversations.open": "tier3",
  "slack.conversations.replies": "tier3",
  "slack.conversations.setPurpose": "tier2",
  "slack.conversations.setTopic": "tier2",
  // A `url_private` file download is NOT a Web API method, so Slack publishes no tier for it. Rather than
  // invent a quota, it is paced as tier3 — a real documented tier, already in `PACED_CLASSES`, and the same
  // class as the thread read it accompanies. Deliberately conservative: a 33-attachment thread (the
  // measured maximum) spends ~40s spacing its downloads rather than bursting into a 429.
  "slack.files.download": "tier3",
  "slack.files.info": "tier4",
  "slack.files.list": "tier3",
  "slack.files.uploadV2": "tier4",
  "slack.pins.list": "tier2",
  // The read-only research probe. `tier2` rather than a per-method class, because ONE label covers every
  // method on `atlas/slackApi/probePolicy.ts`'s allowlist, and those span Tier 2 to Tier 4. Classifying a
  // multi-method label at its TIGHTEST member is the only safe direction: the alternative paces a Tier-2
  // `search.messages` at Tier-4's rate and earns the 429 this table exists to avoid. Tighter still is
  // `assistant.search.context`, at a documented 10+/min that no class here names — a probe walking many of
  // its pages needs an explicit page bound rather than trust in this figure.
  "slack.probe": "tier2",
  // The poll ballot lane. `reactions.add` seeds one chip per option right after the post, and
  // `reactions.get` is the LIVE vote read — both Tier 3 per Slack's published tiers, which is also what puts
  // them inside PACED_CLASSES, so seeding five chips is paced rather than bursted.
  // The review-state read's live Slack leg. `search.messages` is Tier 2 per Slack's published method-tier
  // table, and it is the only method that can answer "was this pull request ever linked in Slack" over the
  // window the local corpus has not ingested yet. Its own recall traps — a `next_cursor` filed under
  // `messages.pagination` rather than `response_metadata`, and proximate matches collapsed by design — are
  // stated as residue by the caller rather than paced around here.
  "slack.search.messages": "tier2",
  "slack.reactions.add": "tier3",
  "slack.reactions.get": "tier3",
  // The completion-reaction swap removes the capture-time emoji before adding the completion one. Same
  // published Tier 3 as `reactions.add`, which it always runs alongside.
  "slack.reactions.remove": "tier3",
  "slack.team.info": "tier3",
  // Resolving a poll's `@group` ping. Tier 2 per Slack's published tiers.
  "slack.usergroups.list": "tier2",
  "slack.users.list": "tier2",
  // Whether each person an as-me message tags is still active (`outbound/slack/departedTags.ts`). Tier 4 per
  // Slack's published method table.
  "slack.users.info": "tier4",
  // `slack status` — the owner's own status and presence, on the user token. Tiers per Slack's published method
  // table (docs.slack.dev). `users.profile.set` ALSO carries a per-USER cap of 10 updates
  // a minute; one verb run makes one set, so nothing here paces toward it.
  "slack.users.getPresence": "tier3",
  "slack.users.profile.get": "tier4",
  "slack.users.profile.set": "tier3",
  "slack.users.setPresence": "tier2",
};
