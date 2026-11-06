const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });

export function destinationMode(input) {
  const mode = input.destination || 'existing';
  if (!['existing', 'source'].includes(mode)) throw failure('Choose an import destination.');
  return mode;
}

export function sourceKnowledgeBase(value) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    value.id.length > 200 ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 160
  )
    throw failure(
      'Source-name imports require a knowledgeBase object with an id and name on each document.',
      422,
    );
  return { id: value.id.trim(), name: value.name.trim() };
}

export function createKnowledgeDestination(store, connection) {
  const mapped = new Map();
  return async (document) => {
    if (connection.destination !== 'source') return connection.knowledgeBaseId;
    const base = sourceKnowledgeBase(document.knowledgeBase);
    if (mapped.has(base.id)) return mapped.get(base.id);
    const filter = {
      ownerId: connection.ownerId,
      workspaceId: connection.workspaceId,
      type: 'knowledge-base',
      sourceConnectionId: connection._id.toHexString(),
      sourceBaseId: base.id,
    };
    const record = await store.collection('records').findOneAndUpdate(
      filter,
      {
        $set: { sourceName: base.name, updatedAt: new Date().toISOString() },
        $setOnInsert: {
          ...filter,
          name: base.name,
          description: `Imported from ${connection.name}`,
          icon: 'layers',
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    await store
      .collection('records')
      .updateOne(
        { _id: record._id, ownerId: connection.ownerId, nameCustomized: { $ne: true } },
        { $set: { name: base.name } },
      );
    const id = record._id.toHexString();
    mapped.set(base.id, id);
    return id;
  };
}
