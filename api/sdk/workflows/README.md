# AgentZuno executable workflow SDK

Developer reference for writing workflow TypeScript in a local editor or project. If you use AgentZuno’s Admin conversation or built-in Code tab, no separate SDK installation is needed. Start with the [workflow guide](../../../docs/workflows.md) for the in-app steps.

## Install for local authoring

Clone or download the AgentZuno repository. From your separate local TypeScript project, install the SDK from its downloaded folder:

```sh
npm install /absolute/path/to/agentzuno/api/sdk/workflows
```

Replace the path with your checkout location. This installs the JavaScript helpers and TypeScript declarations for autocomplete and type checking. It does not install AgentZuno or grant access to a workspace. Review local changes in Git, then paste the source into AgentZuno’s Code tab to test and publish it under normal Admin permissions.

## Example workflow

```typescript
import { defineWorkflow } from '@agentzuno/workflows';

export default defineWorkflow({
  version: 1,
  name: 'Laptop Order',
  trigger: {},
  steps: [{ id: 'desktop', action: 'route', params: { queueName: 'Desktop Support' } }],
  form: {
    title: 'Laptop Order',
    fields: [
      {
        id: 'platform',
        label: 'Platform',
        type: 'select',
        required: true,
        options: ['Mac', 'Windows'],
      },
      { id: 'mouse', label: 'Mouse', type: 'boolean', required: false },
    ],
  },
  async run(ctx) {
    if (ctx.answers.platform === 'Mac') {
      await ctx.route('desktop', 'Desktop Support');
    }
  },
});
```

Create Desktop Support in Users & Groups → Groups before saving this example. `steps` and optional `routing` declare the allowed action IDs and destinations; they do not execute the workflow. `run` controls execution and branches. The Visual tab presents declared actions; Test and Runs show the actual branch executed. Form, permissions and title edits update the source metadata while preserving `run`; changing visual routing explicitly regenerates its executable routing logic.

Supported runtime functions:

- `ctx.route(id, queueName)` and `ctx.handoff(id, queueName)` update the submitted request using an existing workspace queue.
- `ctx.approval(id, { userId, reason })` pauses durably until the designated active Admin, Agent, or User with `canApprove` decides. A requester cannot approve their own run. Check the returned `approved` boolean before continuing.
- `ctx.slack.postMessage(id, { channel, text })` sends through the workspace's encrypted OAuth installation. Use a real channel ID declared in the action manifest; the bot must belong to that channel. Slack setup is required before publication.
- `ctx.answers` contains validated submitted form values. `ctx.request` contains only the frozen request ID, number and title. The server also supplies a limited `ctx.requester` profile (ID, department, and manager reference). No credentials, knowledge bodies, or internal work notes enter the sandbox.

## Build, test and publish

Use the Admin conversation, or edit TypeScript directly. Valid user edits autosave drafts; Publish creates the active immutable source/revision snapshot. Draft edits do not alter published runs. Unpublish prevents new offers and stops pending execution at its next authorization check. Only explicit employee request submission starts a live run; chatting or previewing a form does not.

The Test tab uses sample answers and simulates all actions, including approved approval results. It does not send Slack messages or modify requests. For an offline code test, run from `api/`:

```sh
npm run workflow:test -- /absolute/path/workflow.ts /absolute/path/answers.json
```

The offline test has no live adapters. Server publication and execution additionally enforce current workspace membership, published audience, existing queues, manifest grants, approval authority and connector access.

## Runtime and operational limits

The worker compiles and type-checks source using the bundled TypeScript compiler, then runs it in a fresh QuickJS WebAssembly runtime inside a dedicated worker thread. It does not use Node `eval` or `vm` to execute workflow code. The guest has no Node globals, filesystem, fetch, timers, arbitrary imports, credentials, clock or randomness. The only import is the SDK. CPU interrupts, a 32 MiB guest memory bound, worker heap limits, 40,000-character source limit, 50-action limit and wall deadline bound execution. This is a WebAssembly and worker-thread boundary, not a separate operating-system container or a security certification.

The selected MongoDB or PostgreSQL database stores authoritative runs, frozen inputs, source hashes, revisions, leases and step receipts. BullMQ carries only scoped IDs. A scheduler recovers queued/expired work after outages (normally within 30 seconds). Replaying a run returns completed step results; it does not resend completed actions. Routes use an atomic event marker to avoid duplicate request history. Transient pre-send provider errors can retry up to five attempts. Slack delivery claimed before an uncertain failure becomes Delivery Unknown and requires investigation; it is never automatically resent. Exactly-once delivery across MongoDB and Slack is not promised.

Await each action sequentially and keep stable unique step IDs. Parallel effects, arbitrary npm dependencies, ServiceNow/Jira executors, arbitrary network access, schedules, custom approval expiry and general long-running timers are not implemented. A waiting approval releases compute; its decision requeues the immutable run. The original declarative `runWorkflow` helper remains available for integrations that supply their own host callbacks, but the app uses the TypeScript runtime described here.

Request discovery uses the configured support provider’s understanding of intent. `listRequestWorkflows` exposes only permitted published workflow names, descriptions and form schemas; `offerRequestForm` selects an exact workflow ID for portal review, and `prepareChannelRequest` prepares Slack/Teams review. Trigger phrases are optional legacy metadata and are not pattern-matched for discovery. Without a configured provider, chat does not infer a form. Names and `settings.description` should describe when to use the workflow. Ambiguous requests should prompt one clarification. The server rechecks grants, workspace, department, publication and revision before displaying or submitting a form. Selection never executes a workflow; explicit submission starts it. The offline SDK’s `matchesWorkflow` helper checks department eligibility for an already selected workflow and does not classify text.

Optional `settings` metadata supports `description` (500 characters), `category` (80), `submissionMessage` (500), `timeoutSeconds` (integer 5–60) and `maxConcurrentRuns` (integer 1–10). Published workflow descriptions and receipts use these values. Durable execution enforces the timeout and scoped MongoDB concurrency leases in addition to worker-wide capacity. Approval waits release compute and concurrency slots.

Approval steps support user, group (any one eligible member), and requester-manager targets. Use `when.departmentIds` and/or typed form-value conditions to request approval only when applicable. Set `requireRejectionComment: true` on an approval step when a rejection must include a comment. The backend resolves current membership and manager assignments and enforces the requirement.

Workflow department scope references the configured Departments Data table through `trigger.departmentId`. Omit it for Any Department. The API validates that the record belongs to the current workspace, and discovery, form submission, and workflow execution recheck the requester's current profile reference. The SDK validates reference format; it cannot verify database ownership offline. The deprecated `trigger.department` string remains readable for older workflows and events; it is not an organization department reference. New workflows should use `departmentId`.

## Reference fields

Forms can select existing users or built-in/custom Data records:

```typescript
{ id: 'requested-for', label: 'Requested For', type: 'reference', referenceTable: 'users', required: true }
```

Use the configured Data table ID for other sources. Admin chat receives available table IDs and names; the form editor has a Reference type and table selector. `ctx.answers['requested-for']` is the canonical selected ID. Submission validates current record availability and permissions and stores a display-label snapshot on the request. Publishing a reference field permits workflow users to search labels/IDs; full record access remains subject to existing permissions. Request/task references stay limited to the submitter's accessible records.

## Create a fulfillment task

Declare a `task.create` step with an existing assignment group's `queueName`, a title, and a description. Call `await ctx.tasks.create('step-id', { queueName: 'App Support', title: 'Set up the board', description: String(ctx.answers.justification) })` using the same step ID and group as the manifest. Route the parent request first when both should go to that group.

The server creates the task only for a submitted request after checking the published workflow grant and current requester access. Retries reuse the same task. A published task action does not give employees permission to create or close tasks through ordinary request APIs.

Automatic registration workflows can omit routing and fulfillment tasks. Use an explicit `data.create` manifest with the target table and allowed field IDs, then call `ctx.data.create` after form submission. A reference field targeting `ref-request` can store `String(ctx.request.id)` to link the created row to its originating request. The runtime uses the same typed record service as Admin tools and rechecks the publishing administrator and current action grants. A successful data create/update workflow without routing or fulfillment resolves its request automatically; paused, rejected, or failed workflows do not. Completed mutations reuse their durable receipt on replay.
