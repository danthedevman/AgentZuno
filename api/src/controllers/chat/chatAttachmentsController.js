import { uploadBytes } from '../../shared/uploadBytes.js';
import { Binary } from 'mongodb';
import { fail } from '../../chat/chatAttachments.js';
export function createChatAttachmentsController(store) {
  const postChatAttachments = async (request, response) => {
    const user = request.helpdeskUser;
    const bytes = uploadBytes(request.body, 100000);
    let name;
    try {
      const header = request.headers['x-file-name'];
      if (typeof header !== 'string') throw new Error('Invalid file name header.');
      name = decodeURIComponent(header);
    } catch {
      fail('Invalid file name.');
    }
    if (name.length > 180 || /[\x00-\x1f/\\]/.test(name) || !/\.(txt|md|csv|json|log)$/i.test(name))
      fail('Supported files: TXT, Markdown, CSV, JSON, and LOG.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('The file must contain UTF-8 text.');
    }
    if (!text.trim() || /\x00/.test(text)) fail('The file must contain readable text.');
    const recent = await store
      .collection('chatAttachments')
      .countDocuments({ ownerId: user.id, createdAt: { $gt: new Date(Date.now() - 86400000) } });
    if (recent >= 100) fail('Daily attachment limit reached.', 429);
    const record = {
      ownerId: user.id,
      workspaceId: user.workspaceId,
      name,
      text,
      size: bytes.length,
      data: new Binary(bytes),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    };
    const result = await store.collection('chatAttachments').insertOne(record);
    response.status(201).json({ id: result.insertedId.toHexString(), name, size: record.size });
  };
  return { postChatAttachments };
}
