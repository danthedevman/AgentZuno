const actionFields = {
  route: ['queueName'],
  handoff: ['queueName'],
  'task.create': ['queueName', 'title', 'description'],
  'task.wait': ['taskStepId'],
  'data.read': ['tableId', 'recordId', 'recordIdField', 'fields'],
  'data.create': ['tableId', 'fields'],
  'data.update': ['tableId', 'recordId', 'recordIdField', 'fields'],
  'data.delete': ['tableId', 'recordId', 'recordIdField', 'fields'],
  approval: ['reason', 'target', 'userId', 'groupId', 'requireRejectionComment'],
  'servicenow.createIncident': ['assignmentGroup', 'shortDescription'],
  'slack.postMessage': ['channel', 'text'],
  'jira.createIssue': ['project', 'issueType', 'summary'],
};
export const workflowActions = Object.keys(actionFields);
export const isExternalAction = (action) =>
  action.includes('.') &&
  !['task.create', 'task.wait'].includes(action) &&
  !action.startsWith('data.');
function object(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error('Unexpected workflow fields.');
}
function text(value, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Workflow text must contain 1–${max} characters.`);
  return value.trim();
}
export function defineWorkflow(input) {
  object(input, [
    'version',
    'name',
    'trigger',
    'steps',
    'form',
    'routing',
    'permissions',
    'run',
    'displayInCatalog',
    'settings',
  ]);
  if (input.run !== undefined && typeof input.run !== 'function')
    throw new Error('run must be a function.');
  if (input.version !== 1) throw new Error('Unsupported workflow version.');
  object(input.trigger, ['department', 'departmentId', 'phrases']);
  if (input.trigger.department !== undefined) text(input.trigger.department, 80);
  if (
    input.trigger.departmentId !== undefined &&
    (typeof input.trigger.departmentId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(input.trigger.departmentId))
  )
    throw new Error('Choose a valid department reference.');
  if (
    !Array.isArray(input.trigger.phrases) ||
    !input.trigger.phrases.length ||
    input.trigger.phrases.length > 10
  )
    throw new Error('Choose 1–10 trigger phrases.');
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 10)
    throw new Error('Choose 1–10 workflow steps.');
  const steps = input.steps.map((step) => {
    object(step, ['id', 'action', 'params', 'when', 'requireRejectionComment']);
    if (
      step.requireRejectionComment !== undefined &&
      (step.action !== 'approval' || typeof step.requireRejectionComment !== 'boolean')
    )
      throw new Error('Invalid rejection comment setting.');
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(step.id) || !Object.hasOwn(actionFields, step.action))
      throw new Error('Invalid workflow step.');
    const keys = actionFields[step.action];
    object(step.params, keys);
    if (step.action === 'task.wait')
      return {
        id: step.id,
        action: step.action,
        params: { taskStepId: text(step.params.taskStepId, 40) },
      };
    if (step.action.startsWith('data.')) {
      const params = step.params;
      if (
        typeof params.tableId !== 'string' ||
        !/^(ref-[a-z-]{1,60}|[a-f0-9]{24})$/.test(params.tableId) ||
        !Array.isArray(params.fields) ||
        params.fields.length > 20 ||
        (!params.fields.length && step.action !== 'data.delete') ||
        new Set(params.fields).size !== params.fields.length ||
        params.fields.some(
          (field) => typeof field !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(field),
        )
      )
        throw new Error('Choose a table and explicit allowed fields.');
      if (step.action !== 'data.create' && !params.recordId === !params.recordIdField)
        throw new Error('Select one fixed record or form reference field.');
      if (
        params.recordId &&
        (typeof params.recordId !== 'string' || !/^[a-f0-9]{24}$/.test(params.recordId))
      )
        throw new Error('Invalid data record reference.');
      if (
        params.recordIdField &&
        (typeof params.recordIdField !== 'string' ||
          !/^[a-z][a-z0-9-]{0,39}$/.test(params.recordIdField))
      )
        throw new Error('Invalid record form field.');
      return {
        id: step.id,
        action: step.action,
        params: {
          tableId: params.tableId,
          fields: [...params.fields],
          ...(params.recordId ? { recordId: params.recordId } : {}),
          ...(params.recordIdField ? { recordIdField: params.recordIdField } : {}),
        },
      };
    }
    if (step.action === 'approval') {
      const rejectionComment = step.requireRejectionComment ?? step.params.requireRejectionComment;
      if (
        (rejectionComment !== undefined && typeof rejectionComment !== 'boolean') ||
        (step.requireRejectionComment !== undefined &&
          step.params.requireRejectionComment !== undefined &&
          step.requireRejectionComment !== step.params.requireRejectionComment)
      )
        throw new Error('Invalid rejection comment setting.');
      const target =
        step.params.target ||
        (step.params.groupId ? 'group' : step.params.userId ? 'user' : undefined);
      if (target && !['user', 'group', 'manager'].includes(target))
        throw new Error('Invalid approval target.');
      if (
        (target === 'user' && (!step.params.userId || step.params.groupId)) ||
        (target === 'group' && (!step.params.groupId || step.params.userId)) ||
        (target === 'manager' && (step.params.userId || step.params.groupId))
      )
        throw new Error('Choose one approval target.');
      return {
        id: step.id,
        action: step.action,
        params: {
          reason: text(step.params.reason, 2000),
          ...(target ? { target } : {}),
          ...(step.params.userId ? { userId: text(step.params.userId, 80) } : {}),
          ...(step.params.groupId ? { groupId: text(step.params.groupId, 24) } : {}),
        },
        ...(step.when ? { when: step.when } : {}),
        ...(rejectionComment !== undefined ? { requireRejectionComment: rejectionComment } : {}),
      };
    }
    if (step.when !== undefined) throw new Error('Approval conditions apply to approval steps.');

    return {
      id: step.id,
      action: step.action,
      params: Object.fromEntries(
        keys.map((key) => [
          key,
          text(step.params[key], ['text', 'reason', 'description'].includes(key) ? 2000 : 160),
        ]),
      ),
    };
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    throw new Error('Step IDs must be unique.');
  const form = input.form === undefined ? undefined : defineRequestForm(input.form);
  for (const [index, step] of steps.entries()) {
    if (
      step.action === 'task.wait' &&
      !steps
        .slice(0, index)
        .some((item) => item.id === step.params.taskStepId && item.action === 'task.create')
    )
      throw new Error('Wait for a task created earlier in this workflow.');
    if (
      step.action.startsWith('data.') &&
      step.params.recordIdField &&
      !form?.fields.some(
        (field) =>
          field.id === step.params.recordIdField &&
          field.type === 'reference' &&
          field.referenceTable === step.params.tableId,
      )
    )
      throw new Error('Data actions must use a matching reference field.');
  }

  for (const step of steps.filter((step) => step.action === 'approval' && step.when)) {
    object(step.when, ['departmentIds', 'fieldId', 'values']);
    if (
      step.when.departmentIds !== undefined &&
      (!Array.isArray(step.when.departmentIds) ||
        !step.when.departmentIds.length ||
        step.when.departmentIds.length > 30 ||
        step.when.departmentIds.some((id) => typeof id !== 'string' || !id || id.length > 80))
    )
      throw new Error('Choose approval departments.');
    if (step.when.fieldId !== undefined) {
      const field = form?.fields.find((field) => field.id === step.when.fieldId);
      if (
        !field ||
        !Array.isArray(step.when.values) ||
        !step.when.values.length ||
        step.when.values.length > 20 ||
        step.when.values.some((value) =>
          field.type === 'boolean'
            ? typeof value !== 'boolean'
            : typeof value !== 'string' ||
              value.length > 500 ||
              (field.type === 'select' && !field.options.includes(value)),
        )
      )
        throw new Error('Choose valid approval form values.');
    } else if (step.when.values !== undefined)
      throw new Error('Choose the approval condition field.');
    if (!step.when.departmentIds && !step.when.fieldId)
      throw new Error('Provide an approval condition.');
    step.when = {
      ...(step.when.departmentIds ? { departmentIds: [...new Set(step.when.departmentIds)] } : {}),
      ...(step.when.fieldId
        ? { fieldId: step.when.fieldId, values: [...new Set(step.when.values)] }
        : {}),
    };
  }
  const routing = input.routing === undefined ? undefined : defineRouting(input.routing, form);
  if (
    routing?.length &&
    steps.filter((step) => ['route', 'handoff'].includes(step.action)).length !== 1
  )
    throw new Error('Conditional routing requires exactly one default route or handoff step.');
  if (input.displayInCatalog !== undefined && typeof input.displayInCatalog !== 'boolean')
    throw new Error('Display in Catalog must be a boolean.');
  let settings;
  if (input.settings !== undefined) {
    object(input.settings, [
      'description',
      'category',
      'catalogIcon',
      'catalogImageId',
      'submissionMessage',
      'timeoutSeconds',
      'maxConcurrentRuns',
      'accessTracking',
    ]);
    settings = {};
    if (input.settings.accessTracking !== undefined) {
      const tracking = input.settings.accessTracking;
      object(tracking, ['applicationId', 'accessFieldId']);
      if (
        typeof tracking.applicationId !== 'string' ||
        !tracking.applicationId ||
        tracking.applicationId.length > 80 ||
        typeof tracking.accessFieldId !== 'string' ||
        !form?.fields.some(
          (field) =>
            field.id === tracking.accessFieldId &&
            field.required &&
            ['text', 'select'].includes(field.type),
        )
      )
        throw new Error(
          'Access tracking requires an application and a required text or choice access-level field.',
        );
      settings.accessTracking = {
        applicationId: tracking.applicationId,
        accessFieldId: tracking.accessFieldId,
      };
    }
    for (const [key, max] of [
      ['description', 500],
      ['category', 80],
      ['catalogIcon', 40],
      ['catalogImageId', 24],
      ['submissionMessage', 500],
    ]) {
      if (input.settings[key] !== undefined) {
        if (typeof input.settings[key] !== 'string' || input.settings[key].length > max)
          throw new Error('Invalid workflow setting.');
        settings[key] = input.settings[key].trim();
      }
    }
    for (const [key, min, max] of [
      ['timeoutSeconds', 5, 60],
      ['maxConcurrentRuns', 1, 10],
    ]) {
      if (input.settings[key] !== undefined) {
        if (
          !Number.isInteger(input.settings[key]) ||
          input.settings[key] < min ||
          input.settings[key] > max
        )
          throw new Error('Invalid workflow execution limit.');
        settings[key] = input.settings[key];
      }
    }
  }
  return {
    ...(settings ? { settings } : {}),
    ...(input.displayInCatalog === undefined ? {} : { displayInCatalog: input.displayInCatalog }),
    version: 1,
    name: text(input.name, 80),
    trigger: {
      department: input.trigger.department || 'general',
      ...(input.trigger.departmentId ? { departmentId: input.trigger.departmentId } : {}),
      phrases: [...new Set(input.trigger.phrases.map((value) => text(value, 60).toLowerCase()))],
    },
    steps,
    ...(input.run ? { run: input.run } : {}),
    ...(form ? { form } : {}),
    ...(routing ? { routing } : {}),
    ...(input.permissions === undefined
      ? {}
      : { permissions: defineWorkflowPermissions(input.permissions) }),
  };
}
export function defineWorkflowPermissions(input) {
  object(input, ['audience', 'userIds', 'queueNames']);
  if (
    !['workspace', 'restricted'].includes(input.audience) ||
    !Array.isArray(input.userIds) ||
    !Array.isArray(input.queueNames) ||
    input.userIds.length > 100 ||
    input.queueNames.length > 30
  )
    throw new Error('Invalid workflow permissions.');
  const userIds = [...new Set(input.userIds.map((id) => text(id, 80)))];
  const queueNames = [...new Set(input.queueNames.map((name) => text(name, 80)))];
  if (input.audience === 'workspace' && (userIds.length || queueNames.length))
    throw new Error('Workspace access cannot include restricted grants.');
  if (input.audience === 'restricted' && !userIds.length && !queueNames.length)
    throw new Error('Choose at least one user or queue.');
  return { audience: input.audience, userIds, queueNames };
}
export function canUseWorkflow(input, actor) {
  const permissions = input.permissions
    ? defineWorkflowPermissions(input.permissions)
    : { audience: 'workspace' };
  if (permissions.audience === 'workspace') return true;
  return (
    !!actor &&
    (permissions.userIds.includes(actor.id) ||
      (['admin', 'agent'].includes(actor.role) &&
        (actor.queues || []).some((name) => permissions.queueNames.includes(name))))
  );
}
export function defineRouting(rules, form) {
  if (!form || !Array.isArray(rules) || rules.length > 20)
    throw new Error('Conditional routing needs a form and at most 20 rules.');
  const result = rules.map((rule) => {
    object(rule, ['id', 'match', 'conditions', 'action', 'queueName']);
    if (
      typeof rule.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(rule.id) ||
      !['all', 'any'].includes(rule.match) ||
      !['route', 'handoff'].includes(rule.action) ||
      !Array.isArray(rule.conditions) ||
      !rule.conditions.length ||
      rule.conditions.length > 10
    )
      throw new Error('Invalid routing rule.');
    const conditions = rule.conditions.map((condition) => {
      object(condition, ['fieldId', 'operator', 'value']);
      const field = form.fields.find((item) => item.id === condition.fieldId);
      if (!field || !['equals', 'not-equals'].includes(condition.operator))
        throw new Error('Choose an existing form field and comparison.');
      if (field.type === 'boolean') {
        if (typeof condition.value !== 'boolean') throw new Error('Use a boolean condition value.');
      } else {
        text(condition.value, field.type === 'textarea' ? 2000 : 500);
        if (field.type === 'select' && !field.options.includes(condition.value))
          throw new Error('Choose a valid condition option.');
      }
      return { fieldId: field.id, operator: condition.operator, value: condition.value };
    });
    return {
      id: rule.id,
      match: rule.match,
      conditions,
      action: rule.action,
      queueName: text(rule.queueName, 80),
    };
  });
  if (new Set(result.map((rule) => rule.id)).size !== result.length)
    throw new Error('Routing rule IDs must be unique.');
  return result;
}
export function resolveWorkflowRouting(input, answers) {
  const workflow = defineWorkflow(input);
  const values = Object.fromEntries(
    validateFormAnswers(workflow.form, answers).map((answer) => [answer.id, answer.value]),
  );
  const rule = (workflow.routing || []).find((item) => {
    const matches = item.conditions.map((condition) => {
      const equal = values[condition.fieldId] === condition.value;
      return condition.operator === 'equals' ? equal : !equal;
    });
    return item.match === 'all' ? matches.every(Boolean) : matches.some(Boolean);
  });
  const fallback = workflow.steps.find((step) => ['route', 'handoff'].includes(step.action));
  if (!fallback) throw new Error('A default routing step is required.');
  return {
    ruleId: rule?.id || null,
    action: rule?.action || fallback.action,
    queueName: rule?.queueName || fallback.params.queueName,
  };
}
export function defineRequestForm(input) {
  object(input, ['title', 'fields']);
  if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 20)
    throw new Error('Choose 1–20 form fields.');
  const fields = input.fields.map((field) => {
    object(field, ['id', 'label', 'type', 'required', 'options', 'referenceTable']);
    if (
      typeof field.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(field.id) ||
      !['text', 'textarea', 'select', 'boolean', 'reference'].includes(field.type) ||
      typeof field.required !== 'boolean'
    )
      throw new Error('Invalid form field.');
    if (
      field.type === 'reference'
        ? typeof field.referenceTable !== 'string' ||
          !/^(?:users|ref-[a-z-]+|[a-f0-9]{24})$/.test(field.referenceTable)
        : field.referenceTable !== undefined
    )
      throw new Error('Choose a reference table only for reference fields.');
    let options;
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length < 2 || field.options.length > 20)
        throw new Error('Choice fields need 2–20 options.');
      options = field.options.map((option) => text(option, 80));
      if (new Set(options).size !== options.length) throw new Error('Choices must be unique.');
    } else if (field.options !== undefined) throw new Error('Only choice fields accept options.');
    return {
      id: field.id,
      label: text(field.label, 160),
      type: field.type,
      required: field.required,
      ...(options ? { options } : {}),
      ...(field.type === 'reference' ? { referenceTable: field.referenceTable } : {}),
    };
  });
  if (new Set(fields.map((field) => field.id)).size !== fields.length)
    throw new Error('Form field IDs must be unique.');
  return { title: text(input.title, 80), fields };
}
export function validateFormAnswers(input, answers) {
  const form = defineRequestForm(input);
  object(
    answers,
    form.fields.map((field) => field.id),
  );
  return form.fields.map((field) => {
    const value = Object.hasOwn(answers, field.id) ? answers[field.id] : undefined;
    if (value === undefined || value === '') {
      if (field.required) throw new Error(`${field.label} is required.`);
      return { id: field.id, label: field.label, value: field.type === 'boolean' ? false : '' };
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Invalid ${field.label}.`);
    } else {
      text(value, field.type === 'textarea' ? 2000 : 500);
      if (field.type === 'select' && !field.options.includes(value))
        throw new Error(`Choose a valid ${field.label}.`);
    }
    return { id: field.id, label: field.label, value };
  });
}
export function matchesWorkflow(input, event) {
  const workflow = defineWorkflow(input);
  return (
    (workflow.trigger.departmentId
      ? event.departmentId === workflow.trigger.departmentId
      : workflow.trigger.department === 'general' ||
        !event.department ||
        event.department === workflow.trigger.department) &&
    workflow.trigger.phrases.some((phrase) => String(event.text).toLowerCase().includes(phrase))
  );
}
export function toTypeScript(input) {
  const workflow = defineWorkflow(input);
  const literal = (value) => JSON.stringify(value);
  const calls = workflow.steps.map((step) => {
    if (['route', 'handoff'].includes(step.action))
      return `await ctx.${step.action}(${literal(step.id)}, ${literal(step.params.queueName)});`;
    if (step.action === 'slack.postMessage')
      return `await ctx.slack.postMessage(${literal(step.id)}, ${literal(step.params)});`;
    if (step.action === 'task.wait')
      return `await ctx.tasks.wait(${literal(step.id)}, { taskId: task${workflow.steps.findIndex((item) => item.id === step.params.taskStepId)}.id });`;
    if (step.action.startsWith('data.'))
      throw new Error('Data actions require explicit executable workflow code with field values.');
    if (step.action === 'task.create')
      return `const task${workflow.steps.indexOf(step)} = await ctx.tasks.create(${literal(step.id)}, ${literal(step.params)});`;
    if (step.action === 'approval')
      return `if (!(await ctx.approval(${literal(step.id)}, ${literal(step.params.target ? step.params : { ...step.params, userId: 'SELECT_APPROVER_USER_ID' })})).approved) return;`;
    return `throw new Error("This action is not supported by the runtime.");`;
  });
  const rules = (workflow.routing || []).map((rule) => {
    const condition = rule.conditions
      .map(
        (item) =>
          `(ctx.answers[${literal(item.fieldId)}] ?? ${typeof item.value === 'boolean' ? 'false' : "''"}) ${item.operator === 'equals' ? '===' : '!=='} ${literal(item.value)}`,
      )
      .join(rule.match === 'all' ? ' && ' : ' || ');
    return `if (${condition}) { await ctx.${rule.action}(${literal(rule.id)}, ${literal(rule.queueName)}); }`;
  });
  const metadata = JSON.stringify(workflow, null, 2);
  return `import { defineWorkflow } from '@agentzuno/workflows';\n\nexport default defineWorkflow(${metadata.slice(0, -1)},\n  async run(ctx) {\n    ${workflow.steps.map((step, index) => (rules.length && ['route', 'handoff'].includes(step.action) ? rules.join(' else ') + ' else { ' + calls[index] + ' }' : calls[index])).join('\n    ')}\n  }\n});\n`;
}
export async function runWorkflow(input, event, context) {
  const workflow = defineWorkflow(input);
  object(event, ['id', 'workspaceId', 'department', 'departmentId', 'text', 'answers']);
  text(event.id, 160);
  text(event.workspaceId, 160);
  text(event.text, 8000);
  if (!canUseWorkflow(workflow, context?.actor))
    throw new Error('Workflow access is not authorized.');
  if (!matchesWorkflow(workflow, event)) return { status: 'not-matched', steps: [] };
  if (
    !context ||
    !['dry-run', 'execute'].includes(context.mode || 'dry-run') ||
    typeof context.authorize !== 'function'
  )
    throw new Error('An authorization policy is required.');
  const results = [];
  const routing = workflow.routing?.length ? resolveWorkflowRouting(workflow, event.answers) : null;
  for (const original of workflow.steps) {
    const step =
      routing && ['route', 'handoff'].includes(original.action)
        ? { ...original, action: routing.action, params: { queueName: routing.queueName } }
        : original;
    if ((await context.authorize({ workflow, event, step })) !== true)
      throw new Error('Workflow action is not authorized.');
    if ((context.mode || 'dry-run') === 'dry-run') {
      results.push({ id: step.id, status: 'planned', action: step.action });
      continue;
    }
    if (typeof context.audit !== 'function' || typeof context.executeOnce !== 'function')
      throw new Error('Execution requires durable audit and idempotency handlers.');
    if (
      (isExternalAction(step.action) || step.action === 'approval') &&
      (await context.approve?.({ workflow, event, step })) !== true
    )
      throw new Error('Explicit action approval is required.');
    const handler =
      Object.hasOwn(context.actions || {}, step.action) && context.actions[step.action];
    if (typeof handler !== 'function')
      throw new Error('Configure an action adapter before execution.');
    text(context.workflowId, 160);
    text(context.revision, 80);
    const key = [event.workspaceId, context.workflowId, context.revision, event.id, step.id]
      .map(encodeURIComponent)
      .join(':');
    await context.audit({ key, action: step.action, status: 'started' });
    try {
      await context.executeOnce(key, async () => {
        if ((await context.authorize({ workflow, event, step })) !== true)
          throw new Error('Workflow action authorization changed.');
        return handler({ params: step.params, event, idempotencyKey: key });
      });
      await context.audit({ key, action: step.action, status: 'completed' });
      results.push({ id: step.id, status: 'completed', action: step.action });
    } catch {
      await context.audit({ key, action: step.action, status: 'failed' });
      throw new Error('Workflow action failed. Review the audit trail before retrying.');
    }
  }
  return { status: context.mode === 'execute' ? 'completed' : 'planned', steps: results };
}

export function approvalConditionMatches(when, input = {}) {
  if (!when) return true;
  return (
    (!when.departmentIds || when.departmentIds.includes(input.requester?.departmentId)) &&
    (!when.fieldId || when.values.includes(input.answers?.[when.fieldId]))
  );
}
