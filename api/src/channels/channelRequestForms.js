import { validateFormAnswers } from '../../sdk/workflows/index.js';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { createHelpdeskService } from '../requests/helpdesk.js';
import { selectedRequestWorkflow } from '../workflows/requestWorkflowSelection.js';
import { workflowReferenceOptions } from '../workflows/workflowReferences.js';
import { resolveHelpdeskUser, helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { queryString } from '../shared/queryValues.js';
import { auditOperation } from '../audit/audit.js';

export function createChannelRequestForms(store, chats) {
  const service = createHelpdeskService(store, chats);
  const sessions = () => store.collection('channelRequestForms');
  const sourceContext = (provider, source) => ({
    provider,
    sourceId: queryString(String(source._id), 24),
    generation: queryString(provider === 'slack' ? source.slackGeneration : source.generation, 100),
  });
  async function currentActor(user) {
    const actor = await resolveHelpdeskUser(
      store,
      { id: queryString(user.id, 80) },
      queryString(user.workspaceId, 24),
    );
    if (actor.role === 'read-only') deny();
    return actor;
  }
  async function offer(provider, source, user, text, key, draft) {
    if (
      !['slack', 'teams'].includes(provider) ||
      source.ownerId !== helpdeskScope(user).ownerId ||
      source.workspaceId !== user.workspaceId
    )
      deny();
    const actor = await currentActor(user);
    if (!draft?.workflowId) return null;
    let matched;
    try {
      matched = await selectedRequestWorkflow(
        store,
        actor,
        draft.workflowId,
        draft.workflowVersion,
      );
    } catch (error) {
      if ([400, 403, 404, 409].includes(error.status)) return null;
      throw error;
    }
    const item = (await service.requestableWorkflows(actor)).find(
      (row) => row.id === matched.workflowId,
    );
    if (!item) return null;
    const id = createHash('sha256')
      .update(`${provider}:${source._id}:${key}:${actor.id}`)
      .digest('hex')
      .slice(0, 24);
    const context = {
      ...sourceContext(provider, source),
      ...helpdeskScope(actor),
      userId: queryString(actor.id, 80),
    };
    const existing = await sessions().findOne({ _id: new ObjectId(id), ...context });
    if (existing) return existing;
    const conversation = await service.createSupport(actor, {
      requestId: randomUUID(),
      workflowId: item.id,
    });
    const form = { workflowId: item.id, workflowVersion: item.version, ...item.form };
    const workflow = await store
      .collection('helpdeskWorkflows')
      .findOne({ _id: new ObjectId(item.id), ...helpdeskScope(actor) });
    const options = {};
    let fallback = false;
    for (const field of form.fields) {
      if (field.type === 'reference') {
        options[field.id] = await workflowReferenceOptions(
          store,
          actor,
          { ...workflow, ...(workflow.publishedConfig || {}) },
          field,
        );
        if (options[field.id].length >= 30 || !options[field.id].length) fallback = true;
      }
      if (!['text', 'textarea', 'select', 'boolean', 'reference'].includes(field.type))
        fallback = true;
    }
    let ready = false;
    const answers = draft?.workflowId === item.id ? draft.answers || {} : {};
    try {
      validateFormAnswers({ title: form.title, fields: form.fields }, answers);
      ready = Object.keys(answers).length > 0;
    } catch {}
    const record = {
      answers,
      ready,
      _id: new ObjectId(id),
      ...context,
      chatId: conversation.id,
      form,
      options,
      fallback,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60000),
    };
    if (
      provider === 'teams' &&
      Buffer.byteLength(JSON.stringify(teamsRequestCard(record, portal)), 'utf8') > 24000
    )
      record.fallback = true;
    try {
      await sessions().insertOne(record);
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return sessions().findOne({ _id: new ObjectId(id), ...context });
  }
  async function load(provider, source, user, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) deny('Invalid request form.', 400);
    const actor = await currentActor(user);
    const session = await sessions().findOne({
      _id: new ObjectId(id),
      ...sourceContext(provider, source),
      ...helpdeskScope(actor),
      userId: queryString(actor.id, 80),
      expiresAt: { $gt: new Date() },
    });
    if (!session)
      deny(
        'This form expired or is not available to your account. Ask for the request again.',
        409,
      );
    const item = (await service.requestableWorkflows(actor)).find(
      (row) => row.id === session.form.workflowId && row.version === session.form.workflowVersion,
    );
    if (!item) deny('This request changed or is no longer available. Ask for it again.', 409);
    return { session, actor };
  }
  async function submit(provider, source, user, id, answers) {
    const { session, actor } = await load(provider, source, user, id);
    if (session.fallback) deny('Complete this request in AgentZuno.', 400);
    if (
      !answers ||
      typeof answers !== 'object' ||
      Array.isArray(answers) ||
      Object.keys(answers).some((key) => !session.form.fields.some((field) => field.id === key))
    )
      deny('Invalid request answers.', 400);
    const request = await auditOperation(
      store,
      { ...actor, ownerId: helpdeskScope(actor).ownerId },
      `${provider}-request-submission`,
      '/channels/requests',
      () =>
        service.submitForm(actor, session.chatId, {
          workflowId: session.form.workflowId,
          workflowVersion: session.form.workflowVersion,
          answers,
        }),
      {
        triggerType: 'support-chat',
        triggerLabel: `${provider === 'slack' ? 'Slack' : 'Teams'} request form submission`,
        sourceChatId: session.chatId,
      },
    );
    await sessions().updateOne(
      { _id: session._id, ...helpdeskScope(actor) },
      {
        $set: {
          status: 'submitted',
          requestId: queryString(request.id, 24),
          submittedAt: new Date(),
        },
      },
    );
    return { number: request.number, status: request.status, url: portal(session, request.id) };
  }
  function portal(session, requestId) {
    return `${process.env.APP_ORIGIN || 'http://localhost:3000'}/workspace/${session.workspaceId}/chat/${session.chatId}${requestId ? `?request=${requestId}` : ''}`;
  }
  return { offer, load, submit, portal };
}

const plain = (text) => ({ type: 'plain_text', text: String(text).slice(0, 150), emoji: false });
export function slackRequestButton(session, portal) {
  return {
    type: 'actions',
    elements: [
      session.fallback
        ? {
            type: 'button',
            text: plain('Complete in AgentZuno'),
            url: portal(session),
            action_id: 'agentzuno_request_portal',
          }
        : {
            type: 'button',
            text: plain(session.ready ? 'Submit Request' : 'Open Request Form'),
            value: String(session._id),
            action_id: session.ready ? 'agentzuno_request_confirm' : 'agentzuno_request_open',
          },
    ],
  };
}
export function slackRequestModal(session) {
  return {
    type: 'modal',
    callback_id: 'agentzuno_request_submit',
    private_metadata: String(session._id),
    title: plain(session.form.title.slice(0, 24)),
    submit: plain('Submit Request'),
    close: plain('Cancel'),
    blocks: session.form.fields.map((field, index) => {
      const options =
        field.type === 'reference'
          ? session.options[field.id]
          : (field.type === 'boolean' ? ['Yes', 'No'] : field.options || []).map((value) => ({
              label: value,
              value,
            }));
      const element = ['select', 'boolean', 'reference'].includes(field.type)
        ? {
            type: 'static_select',
            action_id: 'answer',
            placeholder: plain('Choose an option'),
            options: options.length
              ? options.map((option) => ({ text: plain(option.label), value: option.value }))
              : [{ text: plain('No available records'), value: '__none__' }],
          }
        : {
            type: 'plain_text_input',
            action_id: 'answer',
            multiline: field.type === 'textarea',
            max_length: field.type === 'textarea' ? 2000 : 500,
          };
      const value = session.answers?.[field.id];
      if (element.type === 'static_select' && value !== undefined && value !== '') {
        const selected = element.options.find(
          (option) => option.value === (field.type === 'boolean' ? (value ? 'Yes' : 'No') : value),
        );
        if (selected) element.initial_option = selected;
      } else if (element.type === 'plain_text_input' && typeof value === 'string')
        element.initial_value = value;
      return {
        type: 'input',
        block_id: `field_${index}`,
        label: plain(field.label),
        optional: !field.required,
        element,
      };
    }),
  };
}
export function slackRequestAnswers(session, values) {
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).some(
      (key) => !/^field_\d+$/.test(key) || Number(key.slice(6)) >= session.form.fields.length,
    )
  )
    deny('Invalid request answers.', 400);
  return Object.fromEntries(
    session.form.fields.map((field, index) => {
      const element = values[`field_${index}`]?.answer;
      const value = ['select', 'boolean', 'reference'].includes(field.type)
        ? element?.selected_option?.value
        : element?.value;
      if (value !== undefined && value !== null && typeof value !== 'string')
        deny('Invalid request answer.', 400);
      if (field.type === 'boolean' && value && !['Yes', 'No'].includes(value))
        deny('Invalid request answer.', 400);
      return [
        field.id,
        field.type === 'boolean' ? value === 'Yes' : value === '__none__' ? '' : value || '',
      ];
    }),
  );
}
export function teamsRequestCard(session, portal) {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      type: 'AdaptiveCard',
      version: '1.3',
      body: [
        { type: 'TextBlock', text: session.form.title, weight: 'Bolder', wrap: true },
        ...(session.fallback
          ? [
              {
                type: 'TextBlock',
                text: 'Open AgentZuno to complete this form with all available fields and records.',
                wrap: true,
              },
            ]
          : session.form.fields.map((field) => {
              const common = {
                id: field.id,
                label: field.label,
                isRequired: field.required,
                errorMessage: `${field.label} is required.`,
                ...(session.answers?.[field.id] !== undefined
                  ? { value: String(session.answers[field.id]) }
                  : {}),
              };
              if (['select', 'reference'].includes(field.type))
                return {
                  type: 'Input.ChoiceSet',
                  ...common,
                  style: 'compact',
                  choices: (field.type === 'reference'
                    ? session.options[field.id]
                    : field.options.map((value) => ({ label: value, value }))
                  ).map((option) => ({ title: option.label, value: option.value })),
                };
              if (field.type === 'boolean')
                return {
                  type: 'Input.Toggle',
                  ...common,
                  title: field.label,
                  value: String(session.answers?.[field.id] === true),
                  valueOn: 'true',
                  valueOff: 'false',
                  isRequired: false,
                };
              return {
                type: 'Input.Text',
                ...common,
                isMultiline: field.type === 'textarea',
                maxLength: field.type === 'textarea' ? 2000 : 500,
              };
            })),
      ],
      actions: [
        session.fallback
          ? { type: 'Action.OpenUrl', title: 'Complete in AgentZuno', url: portal(session) }
          : {
              type: 'Action.Submit',
              title: 'Submit Request',
              data: { agentzunoAction: 'submit-request', sessionId: String(session._id) },
            },
      ],
    },
  };
}
export function teamsRequestAnswers(session, value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !['agentzunoAction', 'sessionId', ...session.form.fields.map((field) => field.id)].includes(
          key,
        ),
    )
  )
    deny('Invalid request answers.', 400);
  return Object.fromEntries(
    session.form.fields.map((field) => {
      const answer = value[field.id];
      if (answer !== undefined && typeof answer !== 'string') deny('Invalid request answer.', 400);
      if (field.type === 'boolean' && answer !== undefined && !['true', 'false'].includes(answer))
        deny('Invalid request answer.', 400);
      return [field.id, field.type === 'boolean' ? answer === 'true' : answer || ''];
    }),
  );
}

export async function prepareChannelRequestDraft(store, chat, actor, input) {
  if (
    !['slack-support', 'teams-support'].includes(chat.helpdeskPurpose) ||
    actor.role === 'read-only'
  )
    deny();
  if (
    input.workflowId !== null &&
    (typeof input.workflowId !== 'string' || !/^[a-f0-9]{24}$/.test(input.workflowId))
  )
    deny('Choose a valid workflow.', 400);
  if (!Array.isArray(input.answers) || input.answers.length > 20)
    deny('Provide up to 20 answers.', 400);
  const matched = await selectedRequestWorkflow(store, actor, input.workflowId);
  const previous = chat.messages
    .filter((message) => message.proposals?.channelRequest?.workflowId === matched.workflowId)
    .at(-1)?.proposals.channelRequest;
  const answers = { ...(previous?.answers || {}) };
  for (const item of input.answers) {
    if (
      !item ||
      typeof item !== 'object' ||
      Object.keys(item).some((key) => !['fieldId', 'value'].includes(key)) ||
      typeof item.fieldId !== 'string' ||
      !matched.form.fields.some((field) => field.id === item.fieldId) ||
      !['string', 'boolean'].includes(typeof item.value)
    )
      deny('Use the published form field IDs and valid answers.', 400);
    answers[item.fieldId] = item.value;
  }
  validateFormAnswers(
    {
      ...matched.form,
      fields: matched.form.fields.map((field) => ({ ...field, required: false })),
    },
    answers,
  );
  const missing = matched.form.fields
    .filter(
      (field) => field.required && (answers[field.id] === undefined || answers[field.id] === ''),
    )
    .map((field) => ({ id: field.id, label: field.label }));
  return {
    proposal: {
      kind: 'channelRequest',
      workflowId: matched.workflowId,
      workflowVersion: matched.workflowVersion,
      answers,
    },
    message: missing.length
      ? 'Ask only for missing required answers.'
      : 'Ready for explicit user confirmation. The app will display Submit Request.',
    missing,
    fields: matched.form.fields,
  };
}
export function slackRequestSummary(session) {
  return {
    type: 'section',
    text: {
      type: 'plain_text',
      text: [
        session.form.title,
        ...session.form.fields
          .filter(
            (field) =>
              session.answers?.[field.id] !== undefined && session.answers[field.id] !== '',
          )
          .map((field) => `${field.label}: ${String(session.answers[field.id]).slice(0, 80)}`),
      ]
        .join('\n')
        .slice(0, 2900),
    },
  };
}
