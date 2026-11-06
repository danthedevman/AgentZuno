export function requestReceipt(ticket, workspaceId) {
  const submittedAt = ticket.formSubmission?.submittedAt || ticket.createdAt || new Date();
  const number = ticket.number?.replace(/^(?:ZUN|Ticket)-/, 'REQ-') || 'Request';
  const id = ticket.id || String(ticket._id);
  const href = ticket.chatId
    ? `/workspace/${workspaceId}/chat/${ticket.chatId}?request=${id}`
    : `/workspace/${workspaceId}/requests/${id}`;
  return {
    id: `request-submitted-${id}`,
    role: 'assistant',
    kind: 'request-confirmation',
    status: 'complete',
    createdAt: submittedAt,
    text: `Your request **${number}** has been submitted.${ticket.formSubmission ? '' : ` [View request](${href})`}${ticket.formSubmission?.submissionMessage ? `\n\n${ticket.formSubmission.submissionMessage}` : ''}`,
    ...(ticket.formSubmission
      ? {
          formReceipt: {
            requestId: id,
            number,
            title: ticket.formSubmission.title,
            answers: ticket.formSubmission.answers,
            submittedAt,
          },
        }
      : {}),
  };
}
export function insertRequestReceipt(messages, receipt) {
  if (messages.some((message) => message.id === receipt.id)) return messages;
  const at = new Date(receipt.createdAt).getTime();
  const next = messages.findIndex((message) => new Date(message.createdAt).getTime() > at);
  const result = [...messages];
  result.splice(next < 0 ? result.length : next, 0, receipt);
  return result;
}
