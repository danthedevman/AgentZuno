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
    link: 'https://learn.microsoft.com/en-us/graph/permissions-reference',
    title: 'Microsoft Graph permissions documentation',
    steps: [
      'Register an organizational application in Microsoft Entra ID. Add a Web redirect URI matching the OAuth Callback below.',
      'Configure delegated Microsoft Graph permissions User.Read and Chat.Read, and obtain the required tenant consent.',
      'Create a client secret and save its value with the Application (client) ID below, then authorize the connection.',
      'This connector currently authorizes Microsoft Graph access. Native Teams bot installation, incoming-message handling, and bot replies are not implemented by this connector.',
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
            {guide().title} ↗
          </a>
        </details>
      )}
    </Show>
  );
}
