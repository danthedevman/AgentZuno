import { ObjectId } from 'mongodb';
import { queryStrings } from '../shared/queryValues.js';

// Call only for articles already authorized for the current response page.
export async function articleListMetadata(store, articles) {
  const creator = (article) => article.createdBy || article.authorId || article.ownerId;
  const ids = [
    ...new Set(
      articles.map(creator).filter((id) => typeof id === 'string' && ObjectId.isValid(id)),
    ),
  ];
  const users = ids.length
    ? await store
        .collection('users')
        .find({ id: { $in: queryStrings(ids, 100, 24) } }, { projection: { id: 1, name: 1 } })
        .toArray()
    : [];
  return new Map(
    articles.map((article) => {
      const person = users.find((user) => user.id === creator(article));
      return [
        String(article._id),
        {
          summary: article.summary || '',
          updatedAt: article.updatedAt || article.createdAt || null,
          author: {
            name: person?.name || '',
            label: article.createdBy || article.authorId ? 'Author' : 'Owner',
          },
        },
      ];
    }),
  );
}
