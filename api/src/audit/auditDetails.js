export function auditDetails(value = {}) {
  return Object.fromEntries(
    [
      'workflowId',
      'workflowName',
      'workflowRunId',
      'requestId',
      'stepId',
      'triggerType',
      'triggerLabel',
      'sourceChatId',
      'responseId',
      'toolCallId',
      'toolName',
    ]
      .filter((key) => typeof value[key] === 'string' && value[key])
      .map((key) => [key, value[key].replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200)]),
  );
}

export function workflowAuditDetails(run, stepId, triggerType = 'workflow-step') {
  return auditDetails({
    workflowId: run.workflowId,
    workflowName: run.definition?.name,
    workflowRunId: String(run._id),
    requestId: run.requestId,
    stepId,
    triggerType,
    triggerLabel:
      triggerType === 'approval-decision'
        ? 'Assigned approver decision'
        : stepId
          ? `Published workflow step: ${stepId}`
          : 'Submitted request matched a published workflow',
  });
}
