import { slackSigningSecret } from '../../channels/channelApplications.js';
import { verifySlackSignature } from '../../channels/helpdeskSlack.js';
export function createChannelEventsController(integrations, slack, teams) {
  return {
    receiveTeams: async (request, response) => {
      response
        .status(202)
        .json(
          await teams.receive(
            request.body,
            request.headers.authorization,
            request.params.workspaceId,
          ),
        );
    },
    interactSlack: async (request, response) => {
      verifySlackSignature(
        request.body,
        request.headers,
        await slackSigningSecret(integrations, request.params.workspaceId),
      );
      let payload;
      try {
        const params = new URLSearchParams(request.body.toString('utf8'));
        if (params.getAll('payload').length !== 1) throw new Error();
        payload = JSON.parse(params.get('payload'));
      } catch {
        return response.status(400).json({ error: 'Invalid Slack interaction.' });
      }
      response.json(await slack.interact(payload, request.params.workspaceId));
    },
    receiveSlack: async (request, response) => {
      verifySlackSignature(
        request.body,
        request.headers,
        await slackSigningSecret(integrations, request.params.workspaceId),
      );
      let body;
      try {
        body = JSON.parse(request.body.toString('utf8'));
      } catch {
        return response.status(400).json({ error: 'Invalid Slack event.' });
      }
      response.json(await slack.receive(body, request.params.workspaceId));
    },
  };
}
