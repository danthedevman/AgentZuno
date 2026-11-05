import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';
const uri = process.env.TEST_MONGODB_URI;
test(
  'conversations require explicit ticket submission and work notes are isolated from requester comments and responses',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_ticket_journal_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(database);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(actor, path, method = 'GET', body) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { cookie: actor.cookie, 'X-Workspace-Id': actor.workspaceId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    async function register(name) {
      const result = await call(null, '/auth/register', 'POST', {
        timezone: 'America/New_York',
        email: `${name}@journal.test`,
        password: 'Fictional-journal-password!',
      });
      assert.equal(result.status, 201);
      return { ...result.body.user, cookie: result.cookie };
    }
    try {
      const admin = await register('admin');
      const initialProfile = await call(admin, `/helpdesk/workforce-profiles/${admin.id}`);
      assert.equal(initialProfile.body.fields.timezone, 'America/New_York');
      const employee = await register('employee');
      const agent = await register('agent');
      const outsider = await register('outsider');
      const separateWorkspace = { ...outsider };
      employee.workspaceId = admin.workspaceId;
      agent.workspaceId = admin.workspaceId;
      outsider.workspaceId = admin.workspaceId;
      await call(admin, '/helpdesk/queues', 'POST', {
        name: 'general',
        description: '',
        routingInstructions: '',
        agentIds: [admin.id],
      });
      for (const actor of [employee, agent, outsider])
        assert.equal(
          (
            await call(admin, '/helpdesk/members', 'POST', {
              email: actor.email,
              role: actor === agent ? 'agent' : 'user',
              queues: actor === agent ? ['general'] : [],
              active: true,
              canApprove: false,
            })
          ).status,
          201,
        );
      assert.equal(
        (await call(employee, '/helpdesk/chat-settings')).body.greeting,
        'How can I help you?',
      );
      assert.equal(
        (await call(employee, '/helpdesk/chat-settings', 'PUT', { greeting: 'Override' })).status,
        403,
      );
      assert.equal(
        (await call(admin, '/helpdesk/chat-settings', 'PUT', { greeting: '' })).status,
        400,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/chat-settings', 'PUT', {
            greeting: 'How can our team help?',
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(employee, '/helpdesk/chat-settings')).body.greeting,
        'How can our team help?',
      );
      assert.equal(
        (await call(separateWorkspace, '/helpdesk/chat-settings')).body.greeting,
        'How can I help you?',
      );
      assert.equal((await call(employee, '/helpdesk/chat-settings')).body.agentName, 'Zuno');
      assert.equal(
        (
          await call(employee, '/helpdesk/chat-settings', 'PUT', {
            greeting: 'Hello',
            agentName: 'Override',
            agentIcon: 'chat',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/chat-settings', 'PUT', {
            greeting: 'Hello',
            agentName: '<script>',
            agentIcon: 'chat',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/chat-settings', 'PUT', {
            greeting: 'Hello',
            agentName: 'Helio',
            agentIcon: 'https://image.invalid',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/chat-settings', 'PUT', {
            greeting: 'How can our team help?',
            agentName: 'Helio',
            agentIcon: 'chat',
          })
        ).status,
        200,
      );
      const identity = (await call(employee, '/helpdesk/chat-settings')).body;
      assert.equal(identity.agentName, 'Helio');
      assert.equal(identity.agentIcon, 'chat');
      assert.equal(
        (await call(separateWorkspace, '/helpdesk/chat-settings')).body.agentName,
        'Zuno',
      );
      // Existing greeting-only clients preserve the configured identity.
      await call(admin, '/helpdesk/chat-settings', 'PUT', { greeting: 'How can our team help?' });
      assert.equal((await call(employee, '/helpdesk/chat-settings')).body.agentName, 'Helio');
      const unknownForm = await call(
        employee,
        '/helpdesk/support/conversations/000000000000000000000001/form',
        'POST',
        { workflowId: '000000000000000000000002', workflowVersion: 1, answers: {} },
      );
      assert.equal(
        unknownForm.status,
        404,
        'form submission must reach its authorized handler, not the method allowlist',
      );
      async function uploadFile(name, content) {
        const response = await fetch(base + '/api/helpdesk/chat-attachments', {
          method: 'POST',
          headers: {
            cookie: employee.cookie,
            'X-Workspace-Id': employee.workspaceId,
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(name),
          },
          body: content,
        });
        return { status: response.status, body: await response.json() };
      }
      const uploaded = await uploadFile('slack-help.txt', 'Use the approved software catalog.');
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.body.name, 'slack-help.txt');
      assert.equal(uploaded.body.text, undefined);
      assert.equal((await uploadFile('unsupported.pdf', 'Pretend PDF')).status, 400);
      assert.equal((await uploadFile('bad.txt', Buffer.from([255, 254]))).status, 400);
      assert.equal((await uploadFile('../private.txt', 'bad name')).status, 400);
      const started = await call(employee, '/helpdesk/support/conversations', 'POST', {
        requestId: randomUUID(),
        text: 'Can you explain phone setup?',
        attachmentIds: [uploaded.body.id],
      });
      assert.equal(started.status, 202);
      assert.equal(await db.collection('helpdeskRequests').countDocuments({}), 0);
      assert.deepEqual((await call(admin, '/helpdesk/requests')).body, []);
      assert.equal(
        (
          await call(
            employee,
            `/helpdesk/support/conversations/${started.body.id}/ticket`,
            'POST',
            { title: 'Phone help', text: 'Need setup' },
          )
        ).status,
        409,
      );
      await db
        .collection('chats')
        .updateOne({ _id: new ObjectId(started.body.id) }, { $set: { status: 'complete' } });
      const submitted = await call(
        employee,
        `/helpdesk/support/conversations/${started.body.id}/ticket`,
        'POST',
        { title: 'Phone help', text: 'Please configure my office phone' },
      );
      assert.equal(submitted.status, 201);
      const id = submitted.body.id;
      assert.match(submitted.body.number, /^REQ-/);
      const review = await call(employee, `/helpdesk/requests/${id}/review`, 'POST', {});
      assert.equal(review.status, 202);
      const repeated = await call(employee, `/helpdesk/requests/${id}/review`, 'POST', {});
      assert.equal(repeated.body.chatId, review.body.chatId);
      assert.equal(
        (await call(outsider, `/helpdesk/requests/${id}/review`, 'POST', {})).status,
        404,
      );
      assert.equal((await call(admin, `/helpdesk/requests/${id}/review`, 'POST', {})).status, 202);
      const reviewRecord = await db
        .collection('chats')
        .findOne({ _id: new ObjectId(review.body.chatId) });
      assert.equal(reviewRecord.ticketSubmitted, true);
      assert.equal(review.body.chatId, started.body.id);
      assert.ok(!reviewRecord.messages[0].text.includes('Review my submitted ticket'));
      const legacyText =
        'Review my submitted ticket and help me resolve it. Suggest safe, practical steps and ask one clarifying question at a time if needed. Do not claim any action was executed.\n\nPhone help\nPlease configure my office phone';
      await db.collection('chats').updateOne(
        { _id: reviewRecord._id },
        {
          $set: {
            title: legacyText.slice(0, 80),
            'messages.0.text': legacyText,
            ticketReview: true,
          },
        },
      );
      const legacyVisible = await call(
        employee,
        `/helpdesk/support/conversations/${review.body.chatId}`,
      );
      assert.equal(
        legacyVisible.body.messages[0].text,
        'Phone help\nPlease configure my office phone',
      );
      assert.equal(legacyVisible.body.title, 'Phone help');
      const recentReviews = await call(employee, '/helpdesk/support/conversations');
      assert.ok(!JSON.stringify(recentReviews.body).includes('Review my submitted ticket'));

      assert.equal(reviewRecord.helpdeskRequestId, id);
      assert.ok(!reviewRecord.messages[0].text.includes('Work notes'));

      assert.equal(submitted.body.description, 'Please configure my office phone');
      assert.ok((await call(admin, '/helpdesk/inbox')).body.some((item) => item.id === id));
      assert.equal((await call(employee, '/helpdesk/inbox')).status, 403);
      const outside = await call(admin, '/helpdesk/requests', 'POST', {
        requestId: randomUUID(),
        title: 'Outside queue',
        text: 'Fixture scope check',
      });
      await db
        .collection('helpdeskRequests')
        .updateOne(
          { _id: new ObjectId(outside.body.id) },
          { $set: { queueName: 'Unassigned Queue' } },
        );
      assert.ok(
        !(await call(admin, '/helpdesk/inbox')).body.some((item) => item.id === outside.body.id),
      );
      assert.equal(
        (await call(admin, `/helpdesk/inbox/${outside.body.id}`, 'PUT', { archived: true })).status,
        403,
      );

      assert.equal(
        (await call(admin, `/helpdesk/inbox/${id}`, 'PUT', { archived: 'true' })).status,
        400,
      );
      assert.equal(
        (await call(admin, `/helpdesk/inbox/${id}`, 'PUT', { archived: true })).status,
        200,
      );
      assert.ok(!(await call(admin, '/helpdesk/inbox')).body.some((item) => item.id === id));
      assert.ok(
        (await call(admin, '/helpdesk/inbox?tab=archive')).body.some((item) => item.id === id),
      );
      assert.ok((await call(agent, '/helpdesk/inbox')).body.some((item) => item.id === id));
      assert.ok(
        !(await call(agent, '/helpdesk/inbox?tab=archive')).body.some((item) => item.id === id),
      );
      assert.equal(
        (await call(separateWorkspace, `/helpdesk/inbox/${id}`, 'PUT', { archived: true })).status,
        404,
      );
      assert.equal(
        (await call(admin, `/helpdesk/requests/${id}`)).body.status,
        submitted.body.status,
      );
      assert.equal(
        (await call(admin, `/helpdesk/requests/${id}`)).body.version,
        submitted.body.version,
      );
      assert.equal(
        (await call(admin, `/helpdesk/inbox/${id}`, 'PUT', { archived: false })).status,
        200,
      );
      assert.ok((await call(admin, '/helpdesk/inbox')).body.some((item) => item.id === id));

      assert.equal(submitted.body.submittedVia, 'zuno');
      assert.deepEqual(submitted.body.messages, []);
      const duplicate = await call(
        employee,
        `/helpdesk/support/conversations/${started.body.id}/ticket`,
        'POST',
        { title: 'Duplicate', text: 'Duplicate' },
      );
      assert.equal(duplicate.body.id, id);
      assert.equal(
        await db.collection('helpdeskRequests').countDocuments({ _id: new ObjectId(id) }),
        1,
      );
      const note = await call(agent, `/helpdesk/requests/${id}/work-notes`, 'POST', {
        version: 1,
        text: 'Internal network configuration; never show to employee.',
      });
      assert.equal(note.status, 200);
      assert.equal(note.body.workNotes.length, 1);
      const read = await call(employee, `/helpdesk/requests/${id}`);
      assert.equal(read.status, 200);
      assert.equal('workNotes' in read.body, false);
      assert.equal(JSON.stringify(read.body).includes('Internal network'), false);
      assert.equal(
        read.body.events.some((event) => event.type === 'work-note-added'),
        false,
      );
      const comments = await call(employee, `/helpdesk/requests/${id}/comments`, 'POST', {
        version: read.body.version,
        text: 'I am available at my desk.',
      });
      assert.equal(comments.status, 200);
      assert.equal(comments.body.messages.length, 1);
      assert.equal('workNotes' in comments.body, false);
      assert.equal(JSON.stringify(comments.body).includes('Internal network'), false);
      assert.equal(
        (
          await call(employee, `/helpdesk/requests/${id}/work-notes`, 'POST', {
            version: comments.body.version,
            text: 'Do not allow',
          })
        ).status,
        403,
      );
      assert.equal((await call(outsider, `/helpdesk/requests/${id}`)).status, 404);
      const ownOutside = await call(agent, '/helpdesk/requests', 'POST', {
        requestId: randomUUID(),
        title: 'Personal IT help',
        text: 'My personal request',
        department: 'it',
      });
      assert.equal(ownOutside.status, 201);
      assert.equal(
        (
          await call(agent, `/helpdesk/requests/${ownOutside.body.id}/work-notes`, 'POST', {
            version: 1,
            text: 'Outside queue',
          })
        ).status,
        403,
      );
      const listed = await call(employee, '/helpdesk/requests');
      assert.equal(JSON.stringify(listed.body).includes('Internal network'), false);
      assert.equal(
        listed.body.some((item) => 'workNotes' in item),
        false,
      );
      const operator = await call(admin, `/helpdesk/requests/${id}`);
      assert.equal(
        operator.body.workNotes[0].text,
        'Internal network configuration; never show to employee.',
      );
      const legacyId = new ObjectId();
      const legacyRequest = randomUUID();
      await db.collection('helpdeskRequests').insertOne({
        _id: legacyId,
        ownerId: admin.id,
        workspaceId: admin.workspaceId,
        requesterId: employee.id,
        requestId: legacyRequest,
        channel: 'web',
        title: 'Legacy chat',
        messages: [],
        events: [],
        approvals: [],
        version: 1,
        status: 'open',
        queueName: 'general',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.collection('chats').insertOne({
        ownerId: employee.id,
        workspaceId: admin.workspaceId,
        requestId: legacyRequest,
        helpdeskPurpose: 'support',
        helpdeskRequestId: legacyId.toHexString(),
      });
      assert.equal(
        (await call(admin, '/helpdesk/requests')).body.some(
          (item) => item.id === legacyId.toHexString(),
        ),
        false,
      );
      assert.equal((await call(employee, `/helpdesk/requests/${legacyId}`)).status, 404);
      await db.collection('chats').insertMany(
        Array.from({ length: 31 }, (_, index) => ({
          ownerId: agent.id,
          workspaceId: admin.workspaceId,
          helpdeskPurpose: 'support',
          requestId: randomUUID(),
          title: `History ${index}`,
          status: 'complete',
          updatedAt: new Date('2026-01-01'),
        })),
      );
      const history = await call(agent, '/helpdesk/support/conversations');
      assert.equal(history.body.items.length, 15);
      const secondPage = await call(
        agent,
        `/helpdesk/support/conversations?cursor=${history.body.nextCursor}`,
      );
      assert.equal(secondPage.body.items.length, 15);
      assert.equal(
        new Set([...history.body.items, ...secondPage.body.items].map((item) => item.id)).size,
        30,
      );
      const lastPage = await call(
        agent,
        `/helpdesk/support/conversations?cursor=${secondPage.body.nextCursor}`,
      );
      assert.equal(lastPage.body.items.length, 2);
      assert.equal(lastPage.body.nextCursor, null);
      assert.equal(
        (await call(agent, '/helpdesk/support/conversations?cursor=malformed')).status,
        400,
      );
      assert.ok(
        !(await call(employee, '/helpdesk/support/conversations')).body.items.some((item) =>
          item.title?.startsWith('History '),
        ),
      );
      await db.collection('chats').updateOne(
        { _id: new ObjectId(started.body.id) },
        {
          $push: {
            messages: {
              id: randomUUID(),
              role: 'user',
              text: 'Private attachment context never shared with operators',
              status: 'complete',
              createdAt: new Date(),
            },
          },
        },
      );
      const workbench = await call(
        agent,
        `/helpdesk/support/conversations/${started.body.id}?request=${id}`,
      );
      assert.equal(workbench.status, 200);
      assert.equal(workbench.body.operatorView, true);
      assert.equal(
        JSON.stringify(workbench.body.messages).includes('Private attachment context'),
        false,
      );
      const operatorReply = await call(
        agent,
        `/helpdesk/support/conversations/${started.body.id}/messages`,
        'POST',
        { text: 'Public support reply from workbench', activeRequestId: id },
      );
      assert.equal(operatorReply.status, 202);
      assert.ok(
        (await call(employee, `/helpdesk/requests/${id}`)).body.messages.some(
          (message) => message.text === 'Public support reply from workbench',
        ),
      );
      assert.equal(
        (await call(outsider, `/helpdesk/support/conversations/${started.body.id}?request=${id}`))
          .status,
        404,
      );
      const assignable = await call(employee, '/helpdesk/requests', 'POST', {
        requestId: randomUUID(),
        title: 'Assignment test',
        text: 'Please help',
      });
      assert.ok(assignable.body.chatId);
      assert.equal(
        (
          await call(employee, `/helpdesk/requests/${assignable.body.id}/assign-self`, 'POST', {
            version: 1,
          })
        ).status,
        403,
      );
      const assigned = await call(
        agent,
        `/helpdesk/requests/${assignable.body.id}/assign-self`,
        'POST',
        { version: 1 },
      );
      assert.equal(assigned.status, 200);
      assert.equal(assigned.body.assignedToId, agent.id);
      assert.equal(
        (
          await call(admin, `/helpdesk/requests/${assignable.body.id}/assign-self`, 'POST', {
            version: 2,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(agent, `/helpdesk/requests/${assignable.body.id}/assign-self`, 'POST', {
            version: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(agent, `/helpdesk/requests/${outside.body.id}/assign-self`, 'POST', {
            version: 1,
          })
        ).status,
        404,
      );
      assert.ok(
        (await call(agent, '/helpdesk/inbox')).body.some(
          (item) => item.id === assignable.body.id && item.assignedToId === agent.id,
        ),
      );
      const png = await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#255a77' },
      })
        .png()
        .toBuffer();
      const photo = await fetch(base + '/api/helpdesk/profile-picture', {
        method: 'PUT',
        headers: {
          cookie: employee.cookie,
          'X-Workspace-Id': admin.workspaceId,
          'Content-Type': 'image/png',
        },
        body: png,
      });
      assert.equal(photo.status, 200);
      const largePhoto = await sharp(randomBytes(1024 * 1024 * 3), {
        raw: { width: 1024, height: 1024, channels: 3 },
      })
        .jpeg({ quality: 95 })
        .toBuffer();
      assert.ok(largePhoto.length > 512000);
      const largerUpload = await fetch(base + '/api/helpdesk/profile-picture', {
        method: 'PUT',
        headers: {
          cookie: employee.cookie,
          'X-Workspace-Id': admin.workspaceId,
          'Content-Type': 'image/jpeg',
        },
        body: largePhoto,
      });
      assert.equal(largerUpload.status, 200);

      const savedImage = (await call(agent, `/helpdesk/profile-pictures/${employee.id}`)).body
        .image;
      assert.match(savedImage, /^data:image\/webp;base64,/);
      assert.equal(
        (await sharp(Buffer.from(savedImage.split(',')[1], 'base64')).metadata()).format,
        'webp',
      );
      assert.equal(
        (await call(separateWorkspace, `/helpdesk/profile-pictures/${employee.id}`)).status,
        404,
      );
      assert.equal((await call(null, `/helpdesk/profile-pictures/${employee.id}`)).status, 401);
      const invalid = await fetch(base + '/api/helpdesk/profile-picture', {
        method: 'PUT',
        headers: {
          cookie: employee.cookie,
          'X-Workspace-Id': admin.workspaceId,
          'Content-Type': 'image/png',
        },
        body: Buffer.from('<svg />'),
      });
      assert.equal(invalid.status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
