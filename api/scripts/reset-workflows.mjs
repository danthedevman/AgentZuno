import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
if (!process.argv.includes('--confirm'))
  throw new Error('Pass --confirm to permanently reset workflow data.');
const database = process.env.MONGODB_DATABASE || 'agentzuno';
if (!['agentzuno', 'agentzuno_ui_qa_20261031'].includes(database))
  throw new Error('Reset is restricted to the explicitly authorized local application databases.');
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
try {
  const db = client.db(database);
  const workflowChats = await db
    .collection('chats')
    .find({ helpdeskPurpose: 'workflow', dataDesigner: { $ne: true } }, { projection: { _id: 1 } })
    .toArray();
  const auditId = randomUUID();
  await db.collection('governanceAudit').insertOne({
    _id: auditId,
    actorType: 'maintenance',
    action: 'workflow.reset',
    target: 'workflow-data',
    method: 'JOB',
    startedAt: new Date(),
    outcome: 'started',
    authorization: 'Explicit local operator request to replace existing workflows',
  });
  const counts = {};
  for (const name of [
    'helpdeskWorkflows',
    'helpdeskWorkflowConversations',
    'workflowRuns',
    'workflowRevisions',
  ])
    counts[name] = (await db.collection(name).deleteMany({})).deletedCount;
  counts.workflowChats = (
    await db.collection('chats').deleteMany({
      _id: { $in: workflowChats.map((chat) => chat._id) },
      helpdeskPurpose: 'workflow',
      dataDesigner: { $ne: true },
    })
  ).deletedCount;
  await db
    .collection('governanceAudit')
    .updateOne(
      { _id: auditId },
      { $set: { completedAt: new Date(), outcome: 'completed', counts } },
    );
  console.log(JSON.stringify({ database, deleted: counts }));
} finally {
  await client.close();
}
