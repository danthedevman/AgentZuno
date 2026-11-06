import { requireRole, deny } from '../../identity/helpdeskRoles.js';
import { listResponse } from '../../shared/listQuery.js';
import { workspaceGroups, presentGroup, saveGroup } from '../../identity/groups.js';
export function createGroupsController(store) {
  async function save(request, response) {
    const result = await saveGroup(store, request.helpdeskUser, request.body, request.params.id);
    response.status(request.params.id ? 200 : 201).json(result);
  }
  const getGroups = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const rows = (await workspaceGroups(store, request.helpdeskUser)).map(presentGroup);
    response.json(
      listResponse(request, rows, {
        Group: 'name',
        Description: 'description',
        Members: (item) => item.userIds.length,
        Assignment: (item) => item.assignmentEnabled,
        Approval: (item) => item.approvalEnabled,
        Updated: (item) => Date.parse(item.updatedAt),
      }),
    );
  };
  const getGroupsId = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const group = (await workspaceGroups(store, request.helpdeskUser)).find(
      (item) => String(item._id) === request.params.id,
    );
    if (!group) deny('Group not found.', 404);
    response.json(presentGroup(group));
  };
  return { getGroups, getGroupsId, save };
}
