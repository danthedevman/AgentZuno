import { listResponse } from '../../shared/listQuery.js';
import { searchWorkspace } from '../../workspace/globalSearch.js';
export function createGlobalSearchController(store, helpdesk) {
  const getGlobalSearch = async (request, response) => {
    const rows = await searchWorkspace(
      store,
      request.helpdeskUser,
      request.query.q || '',
      helpdesk,
    );
    response.json(
      listResponse(
        { query: { ...request.query, q: '' } },
        rows,
        { Name: 'title', Type: 'type', Summary: 'summary' },
        { sort: 'Name' },
      ),
    );
  };
  return { getGlobalSearch };
}
