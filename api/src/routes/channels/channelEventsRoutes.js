import express from 'express';
import { createChannelEventsController } from '../../controllers/channels/channelEventsController.js';
export function installChannelEventRoutes(app, integrations, slack, teams) {
  const controller = createChannelEventsController(integrations, slack, teams);
  app.post(
    '/api/helpdesk/channels/teams/events/:workspaceId',
    express.json({ limit: '128kb' }),
    controller.receiveTeams,
  );
  app.post(
    '/api/helpdesk/channels/slack/interactions/:workspaceId',
    express.raw({ type: 'application/x-www-form-urlencoded', limit: '128kb' }),
    controller.interactSlack,
  );
  app.post(
    ['/api/helpdesk/channels/slack/events', '/api/helpdesk/channels/slack/events/:workspaceId'],
    express.raw({ type: 'application/json', limit: '128kb' }),
    controller.receiveSlack,
  );
}
