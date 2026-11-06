import { requireCompatibleDemoReferences } from '../../demo/demoReferences.js';
import { ObjectId } from 'mongodb';

import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { readWorkspace } from '../../data/data.js';

export function createContentController(auth, store, designer = {}) {
  function requireUser(request, response, next) {
    if (!request.user)
      return response.status(401).json({ error: 'Sign in to save records and upload files.' });
    next();
  }
  async function saveRecord(request, response) {
    const existing = request.params.id
      ? (await store.record(request.user.id, request.params.id, request.params.type)) ||
        (request.params.type === 'knowledge-base' && request.params.id === request.user.workspaceId
          ? { id: request.params.id, isDefault: true }
          : null)
      : null;
    if (request.params.id && !existing)
      return response.status(404).json({ error: 'Record not found in your workspace.' });
    const type = request.params.type;
    if (!['knowledge-base', 'file', 'connection'].includes(type))
      return response.status(404).json({ error: 'Unknown record type.' });
    const { name, description = '', uploadId } = request.body || {};
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 160 ||
      typeof description !== 'string' ||
      description.length > 20000
    )
      return response.status(400).json({
        error: 'Enter a name (up to 160 characters) and details (up to 20,000 characters).',
      });
    const record = { type, name: name.trim(), description, updatedAt: new Date().toISOString() };
    if (type === 'knowledge-base') {
      record.icon = 'layers';
      if (existing?.sourceConnectionId) record.nameCustomized = true;
    }
    if (type === 'connection') record.status = 'Not connected';
    if (type === 'file') {
      const fileId = uploadId || existing?.uploadId;
      if (typeof fileId !== 'string' || !(await store.file(request.user.id, fileId)))
        return response.status(400).json({ error: 'Upload a file from your own workspace first.' });
      Object.assign(record, {
        title: name.trim(),
        summary: description,
        uploadId: fileId,
        downloadUrl: `/api/uploads/files/${fileId}`,
        base: request.user.isDemo ? `${request.user.id}-team` : request.user.workspaceId,
      });
    }
    let saved;
    if (existing?.isDefault && type === 'knowledge-base') {
      await designer.integrations
        .collection('records')
        .updateOne(
          { _id: new ObjectId(existing.id), ownerId: request.user.id, type },
          { $set: { ...record, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
      saved = await store.record(request.user.id, existing.id, type);
    } else {
      saved = existing
        ? await store.updateRecord(request.user.id, existing.id, type, record)
        : await store.saveRecord(request.user.id, record);
    }
    response.status(existing ? 200 : 201).json(saved);
  }
  async function saveArticle(request, response) {
    const existing = request.params.id
      ? await store.article(request.user.id, request.params.id)
      : null;
    if (request.params.id && !existing)
      return response.status(404).json({ error: 'Article not found in your workspace.' });
    const { title, body } = request.body || {};
    const status = request.body?.status ?? existing?.status ?? 'Draft';
    if (!['Draft', 'Review', 'Published'].includes(status))
      return response.status(400).json({ error: 'Choose Draft, Review, or Published.' });
    const defaults = await readWorkspace(request.user);
    const records = await store.records(request.user.id);
    const allowedBases = new Set([
      ...defaults.knowledgeBases.map((base) => base.id),
      ...records.filter((item) => item.type === 'knowledge-base').map((base) => base.id),
    ]);
    const allowedTopics = new Set([
      ...(defaults.topics || []).map((topic) => topic.id),
      ...records.filter((item) => item.type === 'topic').map((topic) => topic.id),
    ]);
    if (Object.hasOwn(request.body || {}, 'knowledgeBaseIds'))
      return response.status(400).json({
        error: 'An article must belong to exactly one knowledge base. Use knowledgeBaseId.',
      });
    const base =
      request.body?.knowledgeBaseId !== undefined
        ? request.body.knowledgeBaseId
        : (existing?.base ?? defaults.knowledgeBases[0]?.id);
    const topicIds = request.body?.topicIds ?? existing?.topicIds ?? [];
    await requireCompatibleDemoReferences(
      designer.integrations,
      request.helpdeskUser || request.user,
      existing,
      { base, topicIds },
    );
    if (!request.articlePreviewOnly && Array.isArray(topicIds) && !topicIds.length)
      return response.status(400).json({ error: 'Select at least one topic.' });
    if (
      typeof base !== 'string' ||
      !allowedBases.has(base) ||
      !Array.isArray(topicIds) ||
      topicIds.length > 50 ||
      topicIds.some((id) => typeof id !== 'string' || !allowedTopics.has(id))
    )
      return response
        .status(403)
        .json({ error: 'Select a knowledge base and topics from your own workspace.' });
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.trim().length > 160 ||
      typeof body !== 'string' ||
      body.length > 200000
    )
      return response
        .status(400)
        .json({ error: 'Enter a title (up to 160 characters) and an article body.' });
    const imageIds = new Set();
    const cleanBody = sanitizeHtml(body, {
      allowedTags: [
        'p',
        'br',
        'h2',
        'h3',
        'strong',
        'em',
        's',
        'u',
        'ul',
        'ol',
        'li',
        'blockquote',
        'pre',
        'code',
        'hr',
        'a',
        'img',
      ],
      allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'title'] },
      allowedSchemes: ['https', 'http', 'mailto'],
      transformTags: {
        a: (tagName, attributes) => ({
          tagName,
          attribs: { ...attributes, rel: 'noopener noreferrer' },
        }),
      },
      exclusiveFilter: (frame) => {
        if (frame.tag !== 'img') return false;
        const match = /^\/api\/uploads\/images\/([a-f0-9]{24})$/.exec(frame.attribs.src || '');
        if (!match) return true;
        imageIds.add(match[1]);
        return false;
      },
    });
    for (const id of imageIds) {
      if (!(await store.image(request.user.id, id)))
        return response.status(400).json({ error: 'An image is not available in your workspace.' });
    }
    const text = sanitizeHtml(cleanBody, { allowedTags: [], allowedAttributes: {} }).trim();
    if (!text && !imageIds.size)
      return response.status(400).json({ error: 'Add text or an image to the body.' });
    const attachmentIds = request.body?.attachmentIds ?? existing?.attachmentIds ?? [];
    if (
      !Array.isArray(attachmentIds) ||
      attachmentIds.length > 10 ||
      attachmentIds.some((id) => typeof id !== 'string' || !ObjectId.isValid(id))
    )
      return response.status(400).json({ error: 'Choose up to 10 valid attachments.' });
    for (const id of attachmentIds)
      if (
        !(await designer.integrations.collection('articleAttachments').findOne({
          _id: new ObjectId(id),
          ownerId: request.user.id,
          workspaceId: request.user.workspaceId,
        }))
      )
        return response
          .status(400)
          .json({ error: 'An attachment is not available in your workspace.' });
    const values = {
      workspaceId: request.user.workspaceId,
      attachmentIds: [...new Set(attachmentIds)],
      title: title.trim(),
      status,
      createdAt: existing?.createdAt || existing?.updatedAt || new Date().toISOString(),
      body: cleanBody,
      summary: text.slice(0, 180),
      base,
      topicIds: [...new Set(topicIds)],
      label: 'Your article',
      updatedAt: new Date().toISOString(),
      sections: [],
    };
    if (request.articlePreviewOnly)
      return response.json({
        title: values.title,
        status: values.status,
        body: values.body,
        knowledgeBaseId: base,
        topicIds: values.topicIds,
        attachmentIds: values.attachmentIds,
      });
    const article = request.params.id
      ? await store.updateArticle(
          request.user.id,
          request.params.id,
          values,
          request.articleExpectedUpdatedAt,
        )
      : await store.saveArticle(request.user.id, values, request.articleProposalId);
    if (!article)
      return response.status(request.articleExpectedUpdatedAt === undefined ? 404 : 409).json({
        error:
          request.articleExpectedUpdatedAt === undefined
            ? 'Article not found in your workspace.'
            : 'The article changed. Review a fresh proposal.',
      });
    response.status(request.params.id ? 200 : 201).json(article);
  }
  const postUploadsImages = async (request, response) => {
    if (!Buffer.isBuffer(request.body) || !request.body.length)
      return response.status(400).json({ error: 'Choose a PNG, JPEG, WebP, or GIF image.' });
    let buffer;
    try {
      buffer = await sharp(request.body, { limitInputPixels: 20000000 })
        .rotate()
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      return response
        .status(400)
        .json({ error: 'This image could not be read. Use a PNG, JPEG, WebP, or GIF under 5 MB.' });
    }
    const id = await store.saveImage(request.user.id, buffer);
    response.status(201).json({ id, src: `/api/uploads/images/${id}` });
  };
  const getUploadsImagesId = async (request, response) => {
    const image = await store.image(request.user.id, request.params.id);
    if (!image) return response.status(404).json({ error: 'Image not found.' });
    response.type('image/webp').send(Buffer.from(image.data.buffer));
  };
  const postUploadsFiles = async (request, response) => {
    if (!Buffer.isBuffer(request.body) || !request.body.length)
      return response.status(400).json({ error: 'Choose a non-empty file under 5 MB.' });
    const filename = String(request.headers['x-file-name'] || 'file')
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .slice(0, 160);
    const id = await store.saveFile(request.user.id, request.body, filename);
    response.status(201).json({ id, filename });
  };
  const getUploadsFilesId = async (request, response) => {
    const file = await store.file(request.user.id, request.params.id);
    if (!file) return response.status(404).json({ error: 'File not found.' });
    response
      .set('Content-Disposition', `attachment; filename="${file.filename}"`)
      .type('application/octet-stream')
      .send(Buffer.from(file.data.buffer));
  };
  const getRecordsTypeId = async (request, response) => {
    if (!['knowledge-base', 'file', 'connection', 'topic'].includes(request.params.type))
      return response.status(404).json({ error: 'Unknown record type.' });
    const record =
      (await store.record(request.user.id, request.params.id, request.params.type)) ||
      (request.params.type === 'knowledge-base' && request.params.id === request.user.workspaceId
        ? {
            ...(await readWorkspace(request.user)).knowledgeBases[0],
            type: 'knowledge-base',
            isDefault: true,
          }
        : null);
    if (!record) return response.status(404).json({ error: 'Record not found in your workspace.' });
    response.json(record);
  };
  const patchArticlesIdStatus = async (request, response) => {
    const { status } = request.body || {};
    if (!['Draft', 'Review', 'Published'].includes(status))
      return response.status(400).json({ error: 'Choose Draft, Review, or Published.' });
    const existing = await store.article(request.user.id, request.params.id);
    if (!existing)
      return response.status(404).json({ error: 'Article not found in your workspace.' });
    const defaults = await readWorkspace(request.user);
    const records = await store.records(request.user.id);
    const topics = new Set([
      ...(defaults.topics || []).map((item) => item.id),
      ...records.filter((item) => item.type === 'topic').map((item) => item.id),
    ]);
    if (!existing.topicIds?.length || existing.topicIds.some((id) => !topics.has(id)))
      return response
        .status(400)
        .json({ error: 'Select at least one topic before saving or publishing.' });
    const article = await store.updateArticle(request.user.id, request.params.id, {
      status,
      updatedAt: new Date().toISOString(),
    });
    if (!article)
      return response.status(404).json({ error: 'Article not found in your workspace.' });
    response.json(article);
  };
  return {
    postUploadsImages,
    getUploadsImagesId,
    postUploadsFiles,
    getUploadsFilesId,
    getRecordsTypeId,
    patchArticlesIdStatus,
    requireUser,
    saveRecord,
    saveArticle,
  };
}
