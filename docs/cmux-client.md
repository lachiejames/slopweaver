# The cmux client, the verbs over it, and the event model

How Slopweaver talks to cmux, why it talks that way, and what still needs a screen read.

Companion to [`cmux-supervision.md`](cmux-supervision.md), which surveys what cmux can do. This one is what
is built on it, and what was measured while building it. The verbs reach this client through
[the session harness](session-harness.md), the seam that lets the host change without the verbs changing.

- [1. Why a socket client and not a `cmux` wrapper](./cmux-client/socket-and-measured-facts.md)
  - [2. The measured facts the client is shaped around](./cmux-client/socket-and-measured-facts.md#2-the-measured-facts-the-client-is-shaped-around)
  - [(a) A ref that names nothing does not fail — it addresses the FOCUSED surface](./cmux-client/socket-and-measured-facts.md#a-a-ref-that-names-nothing-does-not-fail--it-addresses-the-focused-surface)
  - [(b) `workspace.list` is scoped to the CALLER'S window, not global](./cmux-client/socket-and-measured-facts.md#b-workspacelist-is-scoped-to-the-callers-window-not-global)
  - [(c) The sidebar family has NO socket method — none](./cmux-client/socket-and-measured-facts.md#c-the-sidebar-family-has-no-socket-method--none)
  - [(d) `system.top`'s process trees hang off SURFACES](./cmux-client/socket-and-measured-facts.md#d-systemtops-process-trees-hang-off-surfaces)
  - [(e) cmux enforces no single-pin invariant — a caller wanting one must check itself](./cmux-client/socket-and-measured-facts.md#e-cmux-enforces-no-single-pin-invariant--a-caller-wanting-one-must-check-itself)
- [3. The verb surface](./cmux-client/verbs-and-events.md)
  - [Taking over the pin — the exact order, and why each step is where it is](./cmux-client/verbs-and-events.md#taking-over-the-pin--the-exact-order-and-why-each-step-is-where-it-is)
  - [4. The event model](./cmux-client/verbs-and-events.md#4-the-event-model)
  - [`session watch` — the supervisor's second prong](./cmux-client/verbs-and-events.md#session-watch--the-supervisors-second-prong)
- [5. Spawn's witness chain](./cmux-client/spawn-witness-chain.md)
  - [5a. Who put that line in the prompt box](./cmux-client/spawn-witness-chain.md#5a-who-put-that-line-in-the-prompt-box)
  - [5b. The same rescue on the SEND path, and the fleet sweep that finds what it missed](./cmux-client/spawn-witness-chain.md#5b-the-same-rescue-on-the-send-path-and-the-fleet-sweep-that-finds-what-it-missed)
- [6. What a sidebar row carries: identity only](./cmux-client/sidebar-and-known-gaps.md)
  - [What a sidebar row can carry at all, and what Slopweaver puts where](./cmux-client/sidebar-and-known-gaps.md#what-a-sidebar-row-can-carry-at-all-and-what-slopweaver-puts-where)
  - [7. What still needs a screen read](./cmux-client/sidebar-and-known-gaps.md#7-what-still-needs-a-screen-read)
  - [8. Known gaps](./cmux-client/sidebar-and-known-gaps.md#8-known-gaps)
