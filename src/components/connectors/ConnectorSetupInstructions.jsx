import { For, Show } from 'solid-js';
const setup = {
  slack: {
    link: 'https://docs.slack.dev/authentication/installing-with-oauth/',
    title: 'Slack OAuth documentation',
    steps: [
      'Copy the app manifest below, then create a Slack app from that manifest in your Slack workspace.',
      'In Slack Basic Information, copy the Client ID, Client Secret, and Signing Secret into Connection Details and save.',
      'In OAuth & Permissions, add the OAuth Callback shown below as an exact Redirect URL. The manifest supplies bot scopes and event subscriptions.',
      'Use Authorize below to install the app. Confirm the event Request URL is verified by Slack; it must be publicly reachable over HTTPS.',
      'Enable Zuno Bot, link Slack member IDs to workspace users, and save. Invite the bot to a channel and mention it, or send a direct message.',
    ],
  },
  gmail: {
    link: 'https://developers.google.com/workspace/gmail/api/auth/scopes',
    title: 'Gmail authorization documentation',
    steps: [
      'Create a Google Cloud project and enable the Gmail API. Configure the OAuth consent screen and its audience or test users.',
      'Create an OAuth client of type Web application. Add the OAuth Callback shown below as an authorized redirect URI.',
      'Configure gmail.readonly and gmail.send scopes. Google may require app verification or Workspace administrator approval.',
      'Save the Client ID and Client Secret below, then authorize with the dedicated support mailbox account.',
      'Enable the support inbox after authorization. Choose whether Zuno replies automatically or saves responses for team review.',
    ],
  },
  outlook: {
    link: 'https://learn.microsoft.com/en-us/graph/permissions-reference',
    title: 'Microsoft Graph permissions documentation',
    steps: [
      'Register an application in Microsoft Entra ID supporting the organization accounts you intend to connect. Add a Web redirect URI matching the OAuth Callback below.',
      'Create a client secret. Copy its value and the Application (client) ID into Connection Details and save.',
      'Configure delegated Microsoft Graph permissions User.Read, Mail.Read, Mail.Send, and offline_access. Obtain administrator consent if your organization requires it.',
      'Authorize with the dedicated support mailbox account, then enable inbox processing and choose whether automatic replies are allowed.',
    ],
  },
  teams: {
    link: 'https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/create-a-bot-for-teams',
    title: 'Microsoft Teams bot setup documentation',
    steps: [
      'Create a single-tenant Microsoft Entra application and an Azure Bot resource using the same application ID. Enable the Microsoft Teams channel.',
      'Save the application ID and client secret below. Configure the Azure Bot messaging endpoint with the Teams Events URL.',
      'Enter the Entra tenant ID and link employee Entra object IDs to active workspace users. Email addresses are never matched automatically; app and SSO permissions still apply.',
      'Enable the bot, save its settings, and install your Teams app package with this bot ID in the personal scope. Personal chats receive answers; channel mentions direct employees to private chat.',
      'Use a public HTTPS endpoint and test with your Microsoft tenant. Commercial Microsoft cloud is supported; sovereign-cloud endpoints and emulator authentication are not enabled.',
    ],
  },
};
export default function ConnectorSetupInstructions(props) {
  return (
    <Show when={setup[props.provider]}>
      {(guide) => (
        <details class="connector-setup-instructions" open>
          <summary>Setup Instructions</summary>
          <ol>
            <For each={guide().steps}>{(step) => <li>{step}</li>}</For>
          </ol>
          <a href={guide().link} target="_blank" rel="noopener noreferrer">
            {guide().title} →
          </a>
        </details>
      )}
    </Show>
  );
}
