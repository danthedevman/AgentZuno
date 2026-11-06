# Requests and tasks

Requests bring an employee's conversation, submitted answers, approvals, and fulfillment work together. Tasks break that work into specific actions for a support group or person.

## Choose the right role

- **Admins** configure workflows and groups, manage requests, and create or edit tasks.
- **Agents** work on records permitted by their assignment groups or direct task assignment. Task access does not automatically grant access to the parent request's private conversation.
- **Users** submit permitted requests and follow their own requests. They can add comments on accessible tasks, but cannot create or close fulfillment tasks or read work notes.
- **Read Only** users inspect permitted records and activity without saving changes or posting messages.

## Submit and follow a request

1. Open **Chat** and describe what you need, or choose an item from **Catalog**.
2. Complete the form presented in the conversation. Review the answers and submit it once.
3. The submitted request appears beside the conversation. Use its tabs to review details, attachments, and related tasks.
4. Continue the conversation for help, or use **My Requests** to return to an existing request.

When a conversation contains multiple requests, use the request selector at the top of the right panel. Each submitted form keeps a link to its own request. A submitted form cannot be submitted again.

![A submitted request alongside its conversation](/help/readme-request-chat-dark.png)

## Create and work on a task

Admins and permitted agents can create a task from a request's **Tasks** tab or from the Tasks table under **Data Tables**. Give it a clear title, an originating request, and enough details for the person doing the work. Set an optional **Due Date** when the work has a deadline.

A workflow can also create fulfillment tasks after submission or approval. The assignment group must exist and have assignment enabled. Tasks appear in the Inbox of their assigned support person and current group members.

Open a task to read its properties and description. Select **Edit**, update the fields in the form, and select **Save**. **Cancel** discards the edit. Dates represent a calendar day and do not shift with the viewer's timezone. Use **Close Complete** when the work is finished. If the parent request is resolved, reopen it before changing its tasks.

![Task properties, due date, comments, and work notes](/help/docs-task-record-dark.png)

## Comments, work notes, and mentions

Use **Comments** for updates that people with access to the record can read. Use **Work Notes** for internal staff context. Work notes are not returned to employees, and each read checks current record and group permissions.

Type **@**, select an available person, and write your message. A suggestion is shown only if that person can read the record; work-note suggestions also require permission to read internal notes. Select **Add Comment** or **Add Note** to save the message and its mentions.

The mentioned person receives an **Inbox** notification that says whether a comment or work note was added. Opening it returns to the record and the relevant conversation tab. Viewing Inbox clears its unread indicator. Notifications can be archived without deleting the comment. Mentioning yourself does not notify you.

Workspace SMTP, configured by an Admin in **Settings**, also allows mention emails. Emails contain a record link rather than the comment or private note body. The server checks membership and access again before sending. Mentions never grant access.

The same comment and work-note controls are available on saved group and data records for authorized administrators. Read-only users may review permitted activity but cannot post.

## Approve or reject work

Eligible approvers receive an Inbox item. Review the request and choose **Approve** or **Reject**. Rejection opens a comment area; provide a reason when the workflow requires it, then confirm your decision. Assigning someone an approval does not grant them administrative permissions.

## If something is missing

An empty Inbox may mean no work is currently assigned to your groups. Ask an Admin to check your group membership and the workflow's assignment. If a mention suggestion is missing, check that the person is active and has access to the record. Selecting a different role or mentioning a person cannot bypass these checks.

## Request selection

The configured support provider infers intent from permitted published workflow names, descriptions and forms, then selects the exact workflow through a typed tool. Trigger phrases are not required or pattern-matched. Ambiguous requests need a clarification; an incidental mention or status question should not offer a new form. The server checks workspace, current permissions, department, publication and revision before exposing or submitting a selected form. A selection only prepares review: the user must explicitly submit before any workflow action runs.
