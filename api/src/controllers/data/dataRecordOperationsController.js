import { deny } from '../../identity/helpdeskRoles.js';

import { createDataRecordOperations } from '../../data/dataRecordOperations.js';
export function createDataRecordOperationsController(store) {
  const service = createDataRecordOperations(store);
  const postDataTablesTableIdRecordsIdDeletionReview = async (req, res) => {
    if (!req.body || Object.keys(req.body).some((key) => key !== 'version'))
      deny('Invalid deletion request.', 400);
    res.json(
      await service.prepareDelete(
        req.helpdeskUser,
        req.params.tableId,
        req.params.id,
        req.body.version,
      ),
    );
  };
  const getDataDeletionsId = async (req, res) => {
    const row = await service.deletion(req.helpdeskUser, req.params.id);
    res.json({
      id: String(row._id),
      tableId: row.tableId,
      recordId: row.recordId,
      name: row.name,
      version: row.version,
      state: row.state,
    });
  };
  const postDataDeletionsIdConfirm = async (req, res) =>
    res.json(await service.confirmDelete(req.helpdeskUser, req.params.id, req.body));
  return {
    postDataTablesTableIdRecordsIdDeletionReview,
    getDataDeletionsId,
    postDataDeletionsIdConfirm,
  };
}
