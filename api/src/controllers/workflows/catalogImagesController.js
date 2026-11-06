import { storedBinaryBytes } from '../../shared/storedBinary.js';
import { uploadBytes } from '../../shared/uploadBytes.js';
import { matchesWorkflowDepartment } from '../../workflows/workflowDepartments.js';
import sharp from 'sharp';
import { ObjectId, Binary } from 'mongodb';
import { deny, helpdeskScope, requireRole } from '../../identity/helpdeskRoles.js';
import { canUseWorkflow } from '../../../sdk/workflows/index.js';

export function createCatalogImagesController(store) {
  const postCatalogImages = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const bytes = uploadBytes(request.body, 5242880);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(request.headers['content-type']))
      deny('Choose a PNG, JPEG, or WebP image up to 5 MB.', 400);
    if (
      (await store.collection('catalogImages').countDocuments({
        ...helpdeskScope(user),
        createdAt: { $gte: new Date(Date.now() - 86400000) },
      })) >= 100
    )
      deny('Image upload limit reached.', 429);
    let optimized;
    try {
      const image = sharp(bytes, { limitInputPixels: 20000000 });
      const metadata = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format)) deny('Invalid image.', 400);
      optimized = await image
        .rotate()
        .resize(640, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      deny('This image could not be read.', 400);
    }
    const result = await store.collection('catalogImages').insertOne({
      ...helpdeskScope(user),
      createdBy: user.id,
      bytes: new Binary(optimized),
      createdAt: new Date(),
    });
    response.status(201).json({ id: String(result.insertedId) });
  };
  const getCatalogImagesId = async (request, response) => {
    const user = request.helpdeskUser;
    if (!ObjectId.isValid(request.params.id)) deny('Image not found.', 404);
    const image = await store
      .collection('catalogImages')
      .findOne({ ...helpdeskScope(user), _id: new ObjectId(request.params.id) });
    if (!image) deny('Image not found.', 404);
    if (user.role !== 'admin') {
      const workflow =
        typeof request.query.workflow === 'string' &&
        ObjectId.isValid(request.query.workflow) &&
        (await store.collection('helpdeskWorkflows').findOne({
          ...helpdeskScope(user),
          _id: new ObjectId(request.query.workflow),
          enabled: true,
        }));
      const definition = (workflow?.publishedConfig || workflow)?.definition;
      if (
        !definition?.displayInCatalog ||
        definition.settings?.catalogImageId !== request.params.id ||
        !canUseWorkflow(definition, user) ||
        !(await matchesWorkflowDepartment(store, user, definition))
      )
        deny('Image not found.', 404);
    }
    response.set('Cache-Control', 'private, no-store').json({
      image: `data:image/webp;base64,${storedBinaryBytes(image.bytes).toString('base64')}`,
    });
  };
  return { postCatalogImages, getCatalogImagesId };
}
