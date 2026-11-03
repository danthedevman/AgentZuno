// Scripted REST resource: GET /articles. Requires Authentication must be enabled.
(function process(request, response) {
  var access = new global.AgentZunoKnowledge();
  try {
    access.requireUser();
  } catch (error) {
    response.setStatus(401);
    return;
  }
  var cursor = String(request.queryParams.cursor || '');
  if (cursor && !/^[a-f0-9]{32}$/.test(cursor)) {
    response.setStatus(400);
    return;
  }
  var records = new GlideRecordSecure('kb_knowledge');
  records.addQuery('workflow_state', 'published');
  if (cursor) records.addQuery('sys_id', '>', cursor);
  records.orderBy('sys_id');
  records.setLimit(100);
  records.query();
  var items = [];
  var lastId = null;
  while (records.next()) {
    lastId = records.getUniqueValue();
    var item = access.article(records);
    if (item) items.push(item);
  }
  response.setBody({ result: { items: items, nextCursor: lastId } });
})(request, response);
