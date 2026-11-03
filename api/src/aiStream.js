const failure = (message) =>
  Object.assign(new Error(message), { status: 422, publicMessage: message });
export async function readAIStream(response, provider, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;
  let text = '';
  let completed = false;
  let truncated = false;
  async function event(frame) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let item;
    try {
      item = JSON.parse(data);
    } catch {
      throw failure('The AI provider returned an invalid stream.');
    }
    if (item.type === 'error' || item.type === 'response.failed' || item.error)
      throw failure('The AI provider interrupted the response. Please retry.');
    let delta = '';
    if (provider === 'openai') {
      if (item.type === 'response.output_text.delta' && typeof item.delta === 'string')
        delta = item.delta;
      if (item.type === 'response.output_text.done' && !text && typeof item.text === 'string')
        delta = item.text;
      if (['response.completed', 'response.incomplete'].includes(item.type)) {
        completed = true;
        truncated = item.type === 'response.incomplete';
      }
    } else if (provider === 'anthropic') {
      if (item.type === 'content_block_delta' && item.delta?.type === 'text_delta')
        delta = item.delta.text || '';
      if (item.type === 'message_delta') truncated = item.delta?.stop_reason === 'max_tokens';
      if (item.type === 'message_stop') completed = true;
    } else if (provider === 'google') {
      delta = (item.candidates?.[0]?.content?.parts || [])
        .filter((part) => !part.thought)
        .map((part) => part.text || '')
        .join('');
      const reason = item.candidates?.[0]?.finishReason;
      if (reason) {
        if (!['STOP', 'MAX_TOKENS'].includes(reason))
          throw failure('The AI provider could not complete this response.');
        completed = true;
        truncated = reason === 'MAX_TOKENS';
      }
    }
    if (typeof delta !== 'string') throw failure('Invalid AI response text.');
    if (delta) {
      text += delta;
      if (text.length > 100000) throw failure('The AI response exceeded the supported text size.');
      await onProgress({ text, phase: 'responding' });
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw failure('The AI response exceeded the supported size.');
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        await event(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      if (buffer.length > 262144) throw failure('The AI stream frame exceeded its limit.');
    }
    buffer += decoder.decode();
    if (buffer.trim()) await event(buffer);
    if (!completed) throw failure('The AI response stream ended before completion. Please retry.');
    if (!text.trim())
      throw failure('The provider returned no text. Try another model or output limit.');
    return { text, truncated };
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error.publicMessage
      ? error
      : failure('The AI response stream was interrupted. Please retry.');
  }
}
