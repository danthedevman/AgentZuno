// Install as a non-client-callable Global Script Include named AgentZunoKnowledge.
var AgentZunoKnowledge = Class.create();
AgentZunoKnowledge.prototype = {
  initialize: function () {},
  requireUser: function () {
    if (!gs.getUserID() || gs.getUserName() === 'guest') throw new Error('Authentication required');
  },
  article: function (record) {
    this.requireUser();
    if (
      !record.isValidRecord() ||
      record.getValue('workflow_state') !== 'published' ||
      !record.canRead() ||
      !new KBKnowledge().canRead(record)
    )
      return null;
    if (
      !record.getElement('short_description').canRead() ||
      !record.getElement('text').canRead() ||
      !record.getElement('kb_knowledge_base').canRead()
    )
      return null;
    var base = new GlideRecordSecure('kb_knowledge_base');
    if (
      !base.get(record.getValue('kb_knowledge_base')) ||
      !base.canRead() ||
      !base.getElement('title').canRead()
    )
      return null;
    return {
      id: record.getUniqueValue(),
      title: record.getValue('short_description'),
      text: record.getValue('text'),
      knowledgeBase: {
        id: record.getValue('kb_knowledge_base'),
        name: base.getValue('title'),
      },
      updatedAt: record.getValue('sys_updated_on'),
    };
  },
  type: 'AgentZunoKnowledge',
};
