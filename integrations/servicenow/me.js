// Scripted REST resource: GET /me. Requires Authentication must be enabled.
(function process(request, response) {
  if (!gs.getUserID() || gs.getUserName() === 'guest') {
    response.setStatus(401);
    return;
  }
  response.setBody({
    result: {
      id: gs.getUserID(),
      name: gs.getUserDisplayName(),
      permissionCheck: 'KBKnowledge.canRead',
    },
  });
})(request, response);
