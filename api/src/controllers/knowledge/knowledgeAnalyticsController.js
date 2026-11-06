export function createKnowledgeAnalyticsController(store, service) {
  const getKnowledgeOverview = async (request, response) =>
    response.json(await service.overview(request.user, request.query.days));
  const postKnowledgeViews = async (request, response) => {
    if (request.user && !request.user.isDemo) await store.ready();
    await service.view(request.user, request.body || {});
    response.status(201).json({ recorded: true });
  };
  const patchTopicsId = async (request, response) =>
    response.json(await service.topic(request.user, request.body || {}, request.params.id));
  const postTopics = async (request, response) =>
    response.status(201).json(await service.topic(request.user, request.body || {}));
  return { getKnowledgeOverview, postKnowledgeViews, patchTopicsId, postTopics };
}
