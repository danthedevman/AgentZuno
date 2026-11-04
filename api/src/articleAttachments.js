import { rateLimit } from 'express-rate-limit';
import { uploadBytes } from './uploadBytes.js';
import { ObjectId, Binary } from 'mongodb';
import { requireRole, deny, helpdeskScope } from './helpdeskRoles.js';
import { canReadAuthoredArticle } from './knowledgeAccess.js';
export function installArticleAttachmentRoutes(app, store) {
  app.use(
    [
      '/api/helpdesk/article-attachment-list/:id',
      '/api/helpdesk/article-attachments/:id',
      '/api/helpdesk/article-attachments',
    ],
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.post('/api/helpdesk/article-attachments', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
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
    if (
      (await store.collection('articleAttachments').countDocuments({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        createdAt: { $gt: new Date(Date.now() - 3600000) },
      })) >= 100
    )
      deny('Attachment upload limit reached. Try again later.', 429);
    const record = {
      ownerId: user.id,
      workspaceId: user.workspaceId,
      name,
      size: bytes.length,
      data: new Binary(bytes),
      createdAt: new Date(),
    };
    const result = await store.collection('articleAttachments').insertOne(record);
    response.status(201).json({ id: result.insertedId.toHexString(), name, size: record.size });
  });
  app.get('/api/helpdesk/article-attachment-list/:id', async (request, response) => {
    const user = request.helpdeskUser;
    if (!ObjectId.isValid(request.params.id)) deny('Article not found.', 404);
    const article = await store
      .collection('articles')
      .findOne({ _id: new ObjectId(request.params.id), ownerId: user.helpdeskOwnerId || user.id });
    if (!article || !(await canReadAuthoredArticle(store, user, article)))
      deny('Article not found.', 404);
    const rows = await store
      .collection('articleAttachments')
      .find(
        {
          _id: { $in: (article.attachmentIds || []).map((id) => new ObjectId(id)) },
          ownerId: article.ownerId,
          workspaceId: user.workspaceId,
        },
        { projection: { name: 1, size: 1 } },
      )
      .toArray();
    response.json(rows.map(({ _id, ...item }) => ({ id: _id.toHexString(), ...item })));
  });
  app.get('/api/helpdesk/article-attachments/:id', async (request, response) => {
    const user = request.helpdeskUser;
    if (!ObjectId.isValid(request.params.id)) deny('Attachment not found.', 404);
    let allowedOwner = user.id;
    if (request.query.article !== undefined) {
      if (typeof request.query.article !== 'string' || !ObjectId.isValid(request.query.article))
        deny('Attachment not found.', 404);
      const article = await store.collection('articles').findOne({
        _id: new ObjectId(request.query.article),
        ownerId: user.helpdeskOwnerId || user.id,
      });
      if (
        !article ||
        !article.attachmentIds?.includes(request.params.id) ||
        !(await canReadAuthoredArticle(store, user, article))
      )
        deny('Attachment not found.', 404);
      allowedOwner = article.ownerId;
    } else requireRole(user, ['admin']);
    const file = await store.collection('articleAttachments').findOne({
      _id: new ObjectId(request.params.id),
      ownerId: allowedOwner,
      workspaceId: user.workspaceId,
    });
    if (!file) deny('Attachment not found.', 404);
    response
      .set('Content-Type', 'application/octet-stream')
      .set(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .set('Cache-Control', 'private, no-store')
      .send(file.data.buffer);
  });
}
