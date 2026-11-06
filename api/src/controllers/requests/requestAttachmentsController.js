import { uploadBytes } from '../../shared/uploadBytes.js';
import { Binary, ObjectId } from 'mongodb';
import {
  helpdeskScope,
  requestScope,
  requireRole,
  requireRequestOperator,
  deny,
} from '../../identity/helpdeskRoles.js';

export function createRequestAttachmentsController(store, service) {
  async function record(user, id, writing = false) {
    const request = await service.get(user, id);
    if (writing) {
      requireRole(user, ['admin', 'agent', 'user']);
      if (request.requesterId !== user.id) requireRequestOperator(user, request);
      if (request.status === 'resolved')
        deny('Reopen the request before uploading attachments.', 409);
    }
    return request;
  }
  const getRequestAttachmentsRequestId = async (request, response) => {
    await record(request.helpdeskUser, request.params.requestId);
    const rows = await store
      .collection('requestAttachments')
      .find(
        { ...helpdeskScope(request.helpdeskUser), requestId: request.params.requestId },
        { projection: { name: 1, size: 1, createdAt: 1, uploadedBy: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    response.json(rows.map(({ _id, ...file }) => ({ id: String(_id), ...file })));
  };
  const postRequestAttachmentsRequestId = async (request, response) => {
    const user = request.helpdeskUser;
    await record(user, request.params.requestId, true);
    const bytes = uploadBytes(request.body, 10485760);
    let name;
    try {
      const header = request.headers['x-file-name'];
      if (typeof header !== 'string') throw new Error('Invalid file name header.');
      name = decodeURIComponent(header);
    } catch {
      deny('Invalid attachment name.', 400);
    }
    if (!name || name.length > 200 || /[\x00-\x1f\/\\]/.test(name))
      deny('Choose a file up to 10 MB with a valid name.', 400);
    const scope = helpdeskScope(user),
      files = store.collection('requestAttachments');
    if (
      (await files.countDocuments({
        ...scope,
        uploadedBy: user.id,
        createdAt: { $gt: new Date(Date.now() - 3600000) },
      })) >= 100
    )
      deny('Attachment upload limit reached. Try again later.', 429);
    if ((await files.countDocuments({ ...scope, requestId: request.params.requestId })) >= 50)
      deny('A request supports up to 50 attachments.', 422);
    const file = {
      ...scope,
      requestId: request.params.requestId,
      name,
      size: bytes.length,
      data: new Binary(bytes),
      uploadedBy: user.id,
      createdAt: new Date(),
    };
    const saved = await files.insertOne(file);
    const changed = await store.collection('helpdeskRequests').updateOne(
      {
        ...requestScope(user),
        _id: new ObjectId(request.params.requestId),
        status: { $ne: 'resolved' },
      },
      { $set: { updatedAt: new Date() }, $inc: { version: 1 } },
    );
    if (!changed.matchedCount) {
      await files.deleteOne({ _id: saved.insertedId, ...scope });
      deny('Request changed. Reload before uploading.', 409);
    }
    response
      .status(201)
      .json({ id: String(saved.insertedId), name, size: file.size, createdAt: file.createdAt });
  };
  const getRequestAttachmentsRequestIdFileId = async (request, response) => {
    await record(request.helpdeskUser, request.params.requestId);
    if (!ObjectId.isValid(request.params.fileId)) deny('Attachment not found.', 404);
    const file = await store.collection('requestAttachments').findOne({
      ...helpdeskScope(request.helpdeskUser),
      requestId: request.params.requestId,
      _id: new ObjectId(request.params.fileId),
    });
    if (!file) deny('Attachment not found.', 404);
    response
      .set('Content-Type', 'application/octet-stream')
      .set('X-Content-Type-Options', 'nosniff')
      .set(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .set('Cache-Control', 'private, no-store')
      .send(file.data.buffer);
  };
  return {
    getRequestAttachmentsRequestId,
    postRequestAttachmentsRequestId,
    getRequestAttachmentsRequestIdFileId,
  };
}
