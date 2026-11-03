// Scripted REST resource: GET /articles/{id}. Requires Authentication must be enabled.
(function process(request, response) {
  var access = new global.AgentZunoKnowledge();
  try {
    access.requireUser();
  } catch (error) {
    response.setStatus(401);
    return;
  }
  var id = String(request.pathParams.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) {
    response.setStatus(404);
    return;
  }
  var record = new GlideRecordSecure('kb_knowledge');
  if (!record.get(id)) {
    response.setStatus(404);
    return;
  }
  var item = access.article(record);
  if (!item) {
    response.setStatus(404);
    return;
  }
  response.setBody({ result: item });
})(request, response);
