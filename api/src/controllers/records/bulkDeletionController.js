import { bulkDeleteRecords } from '../../records/bulkDeletion.js';
export function createBulkDeletionController(store) {
  const postKindBulkDelete = (kind) => async (request, response) => {
    response.json(await bulkDeleteRecords(store, request.helpdeskUser, kind, request.body));
  };
  return { postKindBulkDelete };
}
