# Knowledge

Give employees a place to find answers and give both AI agents useful, permitted reference material. Knowledge is organized into bases, topics, and articles. A published article can appear in the Knowledge Center or be referenced in a conversation when the reader has access.

## Who can do what

- **Admins** organize bases and topics, create and edit articles, review AI proposals, publish content, and manage knowledge permissions.
- **Agents** read permitted knowledge while supporting employees. Their role does not grant workspace administration or permission to change knowledge access.
- **Users** browse the Knowledge Center and ask Zuno questions about published articles they can access.
- **Read Only** users inspect permitted knowledge and configuration without editing or publishing it.

See [Roles & Features](roles-and-features.md) for the broader role guide. Knowledge permissions and private attachment checks still apply to every role.

## Organize bases and topics

1. Open **Knowledge → Bases** and create a knowledge base, such as IT Support.
2. Open the base and add a topic, such as Getting Connected. Topics group related articles and can be expanded to browse their contents.
3. Create an article from the base or topic. Give it a clear title and select its required topic.
4. To change the base name, description, or access, select **Edit Knowledge Base** from its detail view. Set the permissions in the form and select **Save** to save both the base details and access settings.

Use separate bases when teams need different collections or access boundaries. Use topics to make a collection easier to browse.

## Draft an article through conversation

Open a new or existing article. The conversation is on the left; article content and settings are on the right.

Describe what the article should explain. For example:

> Write a guide for connecting to Company Wi-Fi on Mac and Windows. Explain how to sign in with a work account and where to ask for help.

The Admin agent prepares a preview. Read it, ask for changes if needed, and approve the proposal before it is saved. Check organization-specific instructions, links, and security requirements before publishing. You can also edit the title and body manually.

Historical authoring conversations are available in **History**. Add related files in **Attachments** using the upload button or drag and drop.

## Publish and maintain content

Keep unfinished content in Draft. Publish the reviewed article when it is ready for readers. Drafting or saving an article does not make it available as published knowledge. Publishing a reviewed article is an explicit action; it does not require another conversational approval each time.

Update an article when a process changes. Approved AI proposals and saved edits follow the article's publication controls. Use the standalone preview to check what readers will see. When removing content or attachments, review the confirmation before proceeding.

Knowledge changes update the retrieval index through background processing. Retrieval checks current records and permissions; deleting or restricting content must prevent it from being returned even while index cleanup is pending.

## Find answers in chat

Employees can browse the Knowledge Center or ask a natural question, such as “How do I connect to office Wi-Fi?” Zuno can reference relevant permitted published articles and include links to open them alongside the conversation.

Configure an enabled AI provider in **Settings** for live conversations. Publish the article, use a specific title and useful instructions, and verify that the person asking has access. A similar title alone does not guarantee that every phrasing will return that article.

The Admin agent can also reference permitted knowledge while preparing workflows and article proposals. Publishing knowledge does not authorize either agent to change a user's account or provision access in another application; that needs a separately implemented, configured action.

## Control access

Review permissions on the base, topic, and article. Select the intended people or groups, save the changes, and check with an appropriate user role. A published status makes content eligible for reading; it does not override access restrictions.

Private files uploaded into a support conversation remain scoped to that conversation. They are not automatically shared knowledge. Attachments on an article follow the article's authorized access checks.
