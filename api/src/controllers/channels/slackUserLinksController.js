import { createSlackUserLinks } from '../../channels/slackUserLinks.js';
import { createHelpdeskSlack } from '../../channels/helpdeskSlack.js';
export function createSlackUserLinksController(store) {
  const slack = createHelpdeskSlack(store, null);
  const service = createSlackUserLinks(store, slack.configure);
  return {
    discover: async (req, res) => res.json(await service.discover(req.helpdeskUser)),
    page: async (req, res) =>
      res.json(await service.page(req.helpdeskUser, req.params.id, req.query)),
    apply: async (req, res) => res.json(await service.apply(req.helpdeskUser, req.body)),
    inspect: async (req, res) => res.json(await service.inspect(req.user, req.body)),
    complete: async (req, res) => res.json(await service.complete(req.user, req.body)),
  };
}
