# Roles and everyday features

AgentZuno has four workspace roles. Your role determines which actions you can take. Group membership, request ownership, knowledge permissions, and workflow permissions also matter. A link or a visible page does not grant access to the record behind it.

## Choose the right role

| Role      | Everyday work                                                                                                                             | Administration                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin     | Review workspace requests, manage support work, and handle assigned approvals when approval permission is enabled                         | Configure the workspace, manage users and groups, build and publish workflows, manage knowledge and Data Tables, configure connections, and review Audit |
| Agent     | Use My Work and Inbox, work on accessible requests in assignment groups, add comments and internal work notes, and manage permitted tasks | Does not configure providers, manage users, or build and publish workflows                                                                               |
| User      | Ask Zuno for help, browse permitted knowledge and catalog items, submit requests, and follow their own requests                           | Does not create groups, configure workflows, assign fulfillment tasks, or read internal work notes                                                       |
| Read Only | Inspect permitted administrative records and reports, including Audit                                                                     | Does not change operational records, publish content, approve requests, or run AI conversations                                                          |

An Admin does not automatically get access to another person's private chat uploads. Private files and conversations keep their own access checks.

Approval permission is separate from the role. An Admin, Agent, or User needs approval permission and a current assignment to decide an approval. A requester cannot approve their own workflow request. Read Only users cannot approve or reject.

## Set up the workspace — Admin

1. Complete installation database setup before registering the first account. The database choice applies to the installation, not each workspace.
2. Register with your name, email address, and password. Follow the onboarding wizard; you can skip steps and return to Settings later.
3. Configure an AI provider in Settings and make an enabled provider the default before using live AI conversations.
4. Add people and choose their roles. When identity provisioning is enabled, manage membership through the configured identity provider rather than adding local users.
5. Create groups. Enable Assignment Group for support routing, Approval Group for approvals, or both. Add the appropriate people and write routing instructions if needed.
6. Configure only the connections your team needs. Follow each connector's setup instructions and review its enabled actions.

## Build a request workflow — Admin

Open Workflows, select New Workflow, and describe the complete process. For example:

> Create a group called App Support and an item for requesting monday.com. Ask for board name and justification. Assign a task to App Support once submitted.

The Admin agent can create the explicitly requested group, then build the workflow and form in the same conversation. The reply links to saved groups. Workflow changes remain a draft until you publish them.

- **Visual** shows the process at a high level. Zoom out for longer workflows.
- **Form** lets you review and edit the questions employees will answer. Reference fields look up permitted users or Data Table records.
- **Approvals** supports a person, an approval group, or the requester's manager. Conditions can use form values or a configured department. You can require a rejection comment.
- **Settings** controls catalog visibility, category, access, and other workflow options.
- **Code** shows the executable TypeScript. Use Copy or Edit when working directly with it.
- **Test** simulates the workflow before publication. A simulation does not fulfill a real request.
- **Runs** shows executions; **History** contains the saved authoring conversations.

Draft edits save automatically. Publish makes the reviewed version available. Publish Changes stays disabled while the draft matches the published version. Unpublish removes the workflow from active use. Workflow task steps run after submission and create tasks linked to the request; drafting a workflow does not create fulfillment tasks.

## Ask for help and submit a request — User, Agent, or Admin

1. Open Chat and describe what you need, or choose a catalog item.
2. Zuno can answer from permitted published knowledge or offer an appropriate request form. Opening a form does not submit a request.
3. Complete the form and submit it once. The conversation shows confirmation and a link to the request.
4. Use the right-hand request panel to review submitted answers, comments, attachments, and status. If the conversation contains several requests, switch requests at the top of that panel.

Chat attachments are private to their permitted conversation context. Do not assume that uploading a file publishes it to the Knowledge Center. As a reply progresses, the conversation follows it while you are at the bottom. Scroll up to read earlier messages without being pulled back down.

## Work on requests — Agent or Admin

Start at Dashboard and select My Work for your assigned work and personal reports. Everyone lands on Dashboard and can use My Requests there. Use Inbox for accessible work and approvals, or My Requests to find a request. Open the request's conversation to work in its right-hand panel.

Agents work within their permitted assignment groups. Where allowed, assign a request to yourself, edit its details, add a public comment, or add an internal work note. Save edits explicitly. Employees see public comments; internal work notes stay with the support team.

Tasks break fulfillment into smaller pieces. Admins and authorized Agents can create tasks for an accessible request. An Agent must belong to the task's assignment group to change its status. Zuno can propose permitted request and task actions; review and confirm them before application. Users cannot create or close fulfillment tasks directly.

## Decide an approval — assigned approver

Open the assigned approval in Inbox. Review the request and its submitted answers, then choose Approve or Reject. Selecting Reject opens a comment box. Enter a comment when required, then select Confirm Rejection. Cancel returns to the decision buttons. The server rechecks your permission and assignment before accepting the decision. Approval resumes the published workflow; rejection follows its code's rejection path.

## Publish and read knowledge

Admins manage knowledge bases, topics, and articles. An article needs a topic. In an article's conversation, describe the change, inspect the proposed preview, and approve it before saving. Publish when the article is ready for readers. Attach relevant files through the Attachments tab.

Users browse the Knowledge Center and read published content they are allowed to access. Agents and both AI agents also follow knowledge permissions. Base, topic, and article permissions, publication state, and source access checks can limit what is returned. Read Only access does not override these checks.

## Manage reference information — Admin

Data Tables holds built-in records such as groups, assets, departments, and tasks, along with custom tables. Open a table to view its records. Use Fields to change its schema and Settings for its name and description. Admins can add custom fields; protected built-in tables and fields cannot be deleted. Deleting a custom table requires confirmation with its name and removes its records.

Agents and Users use authorized reference lookups in forms rather than receiving access to every record in the referenced table. Read Only users can inspect permitted tables without changing them.

## Review reports and Audit — Admin or Read Only

Open Reports and choose the report you need. Agents have the team reporting views allowed by their role; My Work remains focused on the signed-in operator.

For an audit review, choose Audit, select a time period, and optionally filter by Workflow and Trigger. Search and pagination run on the server. Open an audit row to see its correlation, actor, outcome, changed field names, versions, workflow run, request, and step when available. Trigger information distinguishes an Admin chat, request submission, workflow step, approval decision, configuration change, or API operation.

Use the list's secondary actions to export permitted records as CSV or JSON. Audit records exclude secrets and private content. Older records may not contain newer workflow or trigger metadata. A completed audit operation records that operation's outcome; it does not by itself prove that the whole request is resolved.

## Try fictional records in your workspace

Admins can open Settings, choose an industry, and select Load Demo Data. These records are stored in the installation's selected database and tagged for removal. They can be used with the workspace's enabled AI provider. Use Remove Demo Data to remove the tagged records with confirmation. Other roles use permitted records through their ordinary app views. Keep real and tagged demo records separate when building real workflows.

## Keep your profile current

Open Profile from the account menu. Your name is required; it appears beside your photo when the sidebar is expanded. Choose a PNG, JPEG, or WebP photo up to 5 MB using Change Photo. The image is saved immediately, separately from the profile form.

New accounts use the browser's timezone when available, with UTC as the fallback. The profile's Time Zone dropdown offers common zones and preserves a saved zone outside that list. Administrators can update editable workforce fields; identity-managed fields remain subject to directory controls.

### Fulfillment tasks

Admins and authorized Agents can add tasks from a request’s Tasks tab or from Data Tables → Tasks → Add Task. Choose the originating request, enter a title and details, and save. The Tasks tab displays linked cards. Open a task to edit and save its details, status, or assigned support person, or select Close Complete. The originating request is a read-only reference, with a link when you have permission to open it. Users can read tasks for their own accessible requests but cannot create or complete them; Read Only users cannot modify tasks.

Tasks appear as separate Inbox items for current members of their assignment group and their assigned support person. Membership is checked when the inbox is loaded, so removing group access removes the task from that person’s inbox. Archiving a task is personal and does not archive its parent request. A task assignment does not grant access to the parent’s private conversation or work notes.

### Task dates and record conversations

Open a task to read its properties and description. Select **Edit** to update the task in one form, including its optional **Due Date**, then select **Save**. Due dates represent a calendar day and do not change with the viewer's timezone. Administrators and agents with access to the assignment group or a directly assigned task can edit it; resolved parent requests must be reopened before changing their tasks.

Task records have **Comments** and **Work Notes** tabs. Employees with access to a task can add comments. Internal notes are available to authorized administrators and agents, while read-only users can inspect them without posting. End users cannot read or write internal notes. Group and data-record conversations are available to administrators; read-only audit access does not allow posting. Every read and write checks the current record permissions, and authors are taken from the signed-in account.

Type **@** in a comment or work note and select a person from the suggestions. Suggestions include only active people with permission to read that record. Work-note mentions include only people permitted to read internal notes. The selected person receives an **Inbox** item identifying whether a comment or work note was added, with a link to the record. Viewing Inbox clears its unread indicator; notifications can be archived like other Inbox items. Mentioning yourself does not create a notification.

If workspace SMTP is configured, mentioned people also receive an email with a record link. Emails do not include the comment or private work-note body. Access is checked again before showing notifications and sending email, so a mention never grants permission and revoked access stops delivery.
