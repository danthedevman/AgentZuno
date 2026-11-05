import { Binary } from 'mongodb';
import { storedBinaryBytes } from './storedBinary.js';
import { uploadBytes } from './uploadBytes.js';
import sharp from 'sharp';
import { deny, helpdeskScope } from './helpdeskRoles.js';

export function installProfilePictureRoutes(app, store) {
  app.put('/api/helpdesk/profile-picture', async (request, response) => {
    const user = request.helpdeskUser;
    const bytes = uploadBytes(request.body, 5242880);
    const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          ? 'image/webp'
          : null;
    if (!type || type !== request.headers['content-type'])
      deny('Choose a valid PNG, JPEG, or WebP picture.', 400);
    let optimized;
    try {
      optimized = await sharp(bytes, { limitInputPixels: 20000000 })
        .rotate()
        .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      deny('This image could not be read. Choose a PNG, JPEG, or WebP picture.', 400);
    }
    await store
      .collection('profilePictures')
      .updateOne(
        { _id: user.id },
        { $set: { bytes: new Binary(optimized), type: 'image/webp', updatedAt: new Date() } },
        { upsert: true },
      );
    await store
      .collection('users')
      .updateOne({ id: user.id }, { $inc: { profilePictureVersion: 1 } });
    response.json({ saved: true });
  });
  app.get('/api/helpdesk/profile-pictures/:id', async (request, response) => {
    const user = request.helpdeskUser;
    const member = await store
      .collection('helpdeskMembers')
      .findOne({ ...helpdeskScope(user), userId: request.params.id, active: true });
    if (!member) deny('Profile not found.', 404);
    const picture = await store.collection('profilePictures').findOne({ _id: request.params.id });
    response.set('Cache-Control', 'private, no-store').json({
      image: picture
        ? `data:${picture.type};base64,${storedBinaryBytes(picture.bytes).toString('base64')}`
        : null,
    });
  });
}
