# Executable SOP architecture

Fastack SOPs are structured, versioned workflows. They are not prompts and the
runtime never evaluates generated code. An SOP can include human instructions,
approval gates, explicitly permissioned adapter actions, and calls to other SOPs.

## Safety model

Before a run, the planner recursively expands nested SOPs, rejects cycles, and
collects every required permission. A run is blocked unless the caller grants
the complete permission set. Human instructions and approval gates pause rather
than being silently skipped. Machine actions execute only through registered
adapters; there is no default shell, arbitrary HTTP, or unrestricted filesystem
adapter.

Background execution should require all of the following:

- the flattened plan contains only machine actions;
- every action has a registered adapter and narrow permission;
- credentials come from the OS credential vault, never SOP JSON;
- the user explicitly enables the SOP for background execution;
- destructive or external side effects have approval gates or scoped policies;
- each run produces an append-only audit record and is idempotent or resumable;
- rate, time, spend, and retry limits are configured;
- a global kill switch can stop queued and active runs.

## Adapter examples

Adapters are product code, not AI-generated code. Useful initial adapters are:

- `github.create_issue`, `github.update_file`, `github.create_release`;
- `dropbox.write_file` and `google_drive.write_file`;
- `fastack.create_task`, `fastack.complete_task`, `fastack.publish_sop`;
- allowlisted webhooks with fixed origins and request schemas;
- browser automation constrained to an approved origin and user profile.

Each adapter declares its input schema, permissions, side-effect class,
idempotency behavior, timeout, and redaction rules. A model may propose adapter
calls, but schema validation and policy enforcement decide whether they run.

## Capture-to-SOP path

1. The user explicitly selects a window and starts SOP capture.
2. Native accessibility or browser DOM events create candidate steps.
3. Screenshots are redacted before persistence; originals are discarded.
4. OCR and a local vision model enrich steps with labels and expected states.
5. A text model groups and rewrites the structured trace.
6. The user reviews the draft and maps automatable steps to approved adapters.
7. Fastack versions and publishes the SOP.

Captured UI coordinates alone must never become durable automation. Interfaces
move; executable steps should prefer stable DOM selectors, accessibility IDs,
or service APIs, with screenshots retained as documentation and verification.

## Next implementation phases

1. Sync the SOP library and run records through the existing storage providers.
2. Add schema-driven adapter registration and encrypted credential references.
3. Add a browser-first capture recorder with permanent pre-storage redaction.
4. Add a scheduler/worker process with concurrency and resource limits.
5. Add signed approvals, immutable audit exports, rollback, and organization policy.
