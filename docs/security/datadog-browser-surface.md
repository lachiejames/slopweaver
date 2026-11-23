# The Datadog browser surface

Part of [Security & trust](../security.md).

Datadog is **not** a doored provider under doctrine rule 3, which lists Slack, GitHub, Linear and Vanta. Four
of its API verbs (`datadog verify|probe|metrics|raw`) are an ordinary read client, and its console is
exactly the "doorless surface" [the paragraph above](browser-write-surface.md) leaves untouched. `datadog submit` is the write
[the owner's own ruling above](browser-write-surface.md) put on the explicit write list — the custom metrics post, whatever an
install's declared producer prints through `datadog produce` — and it IS routed through the
admit door (`effect: "external-write"`, `doorRouted: true`) even though the provider is not doored, because
Datadog deletes no metric point and an unjournalled irreversible write is the thing the ledger exists for.
`datadog hmi --enable` is the second, door-routed the same way: it switches Historical Metrics
Ingestion on per metric through the official SDK and reads every metric back, the console toggle it replaces
having given no way to tell whether it took. `datadog monitor update|delete` is the third: it changes or
deletes exact monitors through the SDK, each write held by the door until `--approve` carries the digest of the
change a preview printed, re-checked against a fresh read at write time. It refuses a monitor carrying one of the
install's infrastructure-as-code ownership tags (`profile.json` `datadog.iacManagedTags` in the `--home` profile,
empty by default, which leaves that guard inert) unless `--iac-override` names why, and refuses any change that
adds a recovery block or a non-zero renotify interval, with no override. None is reachable through
`raw`, whose read-only property is enforced by its own TYPE (`src/datadog/rawTransport.ts`); the writes live
apart, in `src/datadog/seriesSubmit.ts`, `src/datadog/historicalIngestion.ts` and `src/datadog/monitorApi.ts`,
named as writes. `datadog shot` does not change that classification —
it makes one part of it a verb instead of a hand-driven browser, because the evidence a monitor pull request
is asked for is a picture of the console's own backtest panel and no endpoint returns one.

Three properties are worth stating rather than inferring:

- **It reads with a browser SESSION, not the two API keys.** It needs the site — `profile.json`'s `datadog.site`, or `DD_SITE`, which wins — and neither key. The session
  is the owner's own, in the owner's own Chrome; no browser profile, and so no live console session, is kept under
  `$SLOPWEAVER_HOME`.
- **The verb launches nothing.** `shot monitor` captures through the Playwright relay into the owner's own,
  already signed-in Chrome ([the browser route](../browser-route/target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome))
  — the `datadog-monitor-backtest` arm, bound by the relay lease to the configured console origin, so a page
  that lands on a sign-in wall elsewhere is refused rather than photographed. `shot explorer` prints one
  `browser shot` command or a brief, and `shot file` grades an image captured elsewhere. There is no headless
  capture and no `shot login`, because there is no profile to sign into.
- **The grading did not move, and that is the point.** A capture is graded before it is reported and a failed
  grade throws the bytes away. The window a panel was computed over is proved from the console's own
  `evaluation_preview` calls, not from the picker's caption, and a capture whose console evaluated a
  different span is refused. That judgement stays in the CLI, where it is pure and cannot be skipped by
  whoever took the picture.
- **It types nothing that saves.** The monitor arm clicks two things — the backtest's time-range picker and
  its `Past 1 Week` preset — on a monitor edit form and reads; the form evaluates without saving, and the
  relay's own tab is closed afterwards. It presses no key, fills no field and never names Save. That is why
  the verb is classified `external-read` and is not door-routed.

The address it opens is checked against the configured site's console host and an allowlist of VIEW paths, so
a settings or billing page is refused. Note the precise guarantee: `DD_SITE` names a SITE, and several
organisations can share one host — the check establishes which site a shot was taken on, never which org the
signed-in profile was looking at.
