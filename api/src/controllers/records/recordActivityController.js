import { recordMentionOptions } from '../../records/recordMentions.js';

import { createRecordActivity } from '../../records/recordActivity.js';
export function createRecordActivityController(store) {
  const service = createRecordActivity(store);
  const getRecordActivityKindIdMentionOptions = async (request, response) =>
    response.json(
      await recordMentionOptions(
        store,
        request.helpdeskUser,
        request.params.kind,
        request.params.id,
        request.query,
      ),
    );
  const getRecordActivityKindId = async (request, response) =>
    response.json(
      await service.list(
        request.helpdeskUser,
        request.params.kind,
        request.params.id,
        request.query,
      ),
    );
  const postRecordActivityKindId = async (request, response) =>
    response
      .status(201)
      .json(
        await service.add(
          request.helpdeskUser,
          request.params.kind,
          request.params.id,
          request.body,
        ),
      );
  return {
    getRecordActivityKindIdMentionOptions,
    getRecordActivityKindId,
    postRecordActivityKindId,
  };
}
