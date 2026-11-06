import { createAuditRetention } from '../../audit/auditRetention.js';
export function createAuditRetentionController(store) {
  const service = createAuditRetention(store);
  const getAuditRetention = async (request, response) =>
    response.json(await service.read(request.helpdeskUser));
  const putAuditRetention = async (request, response) =>
    response.json(await service.save(request.helpdeskUser, request.body));
  return { getAuditRetention, putAuditRetention };
}
