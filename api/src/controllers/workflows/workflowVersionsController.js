import { createWorkflowVersions } from '../../workflows/workflowVersions.js';
import { createHelpdeskWorkflows } from '../../workflows/helpdeskWorkflows.js';
import { listResponse } from '../../shared/listQuery.js';
export function createWorkflowVersionsController(store, chats) {
  const versions = createWorkflowVersions(store, createHelpdeskWorkflows(store, chats));
  const revision = (req) =>
    /^\d{1,9}$/.test(req.params.version) ? Number(req.params.version) : null;
  const list = async (req, res) =>
    res.json(
      listResponse(req, await versions.list(req.helpdeskUser, req.params.id), {
        Version: 'version',
        Saved: 'savedAt',
      }),
    );
  const read = async (req, res) => {
    const result = await versions.read(req.helpdeskUser, req.params.id, revision(req));
    res.json({ version: result.version, config: result.config });
  };
  const restore = async (req, res) =>
    res.json(await versions.restore(req.helpdeskUser, req.params.id, revision(req), req.body));
  return { list, read, restore };
}
