import { decryptSecret, encryptSecret } from './secrets.js';
import { readData } from './data.js';
import { readAIStream } from './aiStream.js';

const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });
export const safeAIProvider = (item) => ({
  provider: item.provider,
  model: item.model,
  instructions: item.instructions,
  maxOutputTokens: item.maxOutputTokens,
  reasoning: item.reasoning,
  enabled: item.enabled,
  hasApiKey: !!item.credential,
});

export async function generateReply(settings, messages, fetcher = fetch, onProgress) {
  const key = decryptSecret(settings.credential);
  const instructions =
    settings.instructions ||
    'You are AgentZuno, a helpful assistant. Be clear and concise. Do not claim to access workspace knowledge or perform actions unless that information or capability is explicitly supplied.';
  const history = messages
    .filter((message) => message.status === 'complete')
    .map(({ role, text }) => ({ role, content: text }));
  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;
  if (settings.provider === 'openai') {
    url = 'https://api.openai.com/v1/responses';
    headers.Authorization = `Bearer ${key}`;
    body = {
      model: settings.model,
      instructions,
      input: history,
      max_output_tokens: settings.maxOutputTokens,
      reasoning: { effort: settings.reasoning },
      store: false,
    };
  } else if (settings.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers.Authorization = `Bearer ${key}`;
    headers['anthropic-version'] = '2026-10-21';
    body = {
      model: settings.model,
      system: instructions,
      messages: history,
      max_tokens: settings.maxOutputTokens,
    };
  } else if (settings.provider === 'google') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
    headers['x-goog-api-key'] = key;
    body = {
      systemInstruction: { parts: [{ text: instructions }] },
      contents: history.map(({ role, content }) => ({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      })),
      generationConfig: { maxOutputTokens: settings.maxOutputTokens },
    };
  } else throw failure('Unsupported AI provider.');
  if (onProgress) {
    if (settings.provider === 'google')
      url = url.replace(':generateContent', ':streamGenerateContent?alt=sse');
    else body.stream = true;
  }
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw failure('The AI provider did not respond in time. Please retry.', 503);
  }
  if (!response.ok)
    throw failure(
      response.status === 401 || response.status === 403
        ? 'The AI provider rejected the credentials or model access. Update Settings.'
        : response.status === 429
          ? 'The AI provider is rate limited or out of credits. Please retry later.'
          : 'The AI provider could not complete this response. Please retry.',
      422,
    );
  if (onProgress && response.headers.get('content-type')?.includes('text/event-stream'))
    return readAIStream(response, settings.provider, onProgress);
  // Bound the response while reading it, before parsing untrusted provider JSON.
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw failure('The AI response exceeded the supported size.', 422);
    }
    chunks.push(Buffer.from(value));
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const text =
    settings.provider === 'openai'
      ? (result.output || [])
          .flatMap((item) => item.content || [])
          .filter((item) => item.type === 'output_text')
          .map((item) => item.text)
          .join('\n')
      : settings.provider === 'anthropic'
        ? (result.content || [])
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')
        : (result.candidates?.[0]?.content?.parts || [])
            .filter((item) => !item.thought)
            .map((item) => item.text || '')
            .join('\n');
  if (!text.trim())
    throw failure(
      'The provider returned no text. Increase the output limit or try another model.',
      422,
    );
  return {
    text: text.slice(0, 100000),
    truncated:
      result.status === 'incomplete' ||
      result.stop_reason === 'max_tokens' ||
      result.candidates?.[0]?.finishReason === 'MAX_TOKENS',
  };
}

export function createAIService(store) {
  async function settings(user) {
    return {
      providers: (
        await store
          .collection('aiProviders')
          .find({ ownerId: user.id, workspaceId: user.workspaceId })
          .toArray()
      ).map(safeAIProvider),
      defaultProvider:
        (
          await store
            .collection('aiPreferences')
            .findOne({ ownerId: user.id, workspaceId: user.workspaceId })
        )?.provider || null,
    };
  }
  async function save(user, input) {
    const catalog = await readData('ai-providers.json');
    const provider = catalog.find((item) => item.id === input.provider);
    if (!provider || !provider.models.some((model) => model.id === input.model))
      throw failure('Choose a supported AI provider and model.');
    if (typeof input.instructions !== 'string' || input.instructions.length > 12000)
      throw failure('Instructions must be text under 12,000 characters.');
    if (
      !Number.isInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 256 ||
      input.maxOutputTokens > 16384
    )
      throw failure('Output limit must be a whole number from 256 to 16,384.');
    if (!['low', 'medium', 'high'].includes(input.reasoning))
      throw failure('Choose a supported reasoning level.');
    if (typeof input.enabled !== 'boolean' || typeof input.isDefault !== 'boolean')
      throw failure('Invalid provider settings.');
    if (
      typeof input.apiKey !== 'string' ||
      input.apiKey.length > 10000 ||
      /[\r\n]/.test(input.apiKey)
    )
      throw failure('Invalid API key.');
    const filter = { ownerId: user.id, workspaceId: user.workspaceId, provider: input.provider };
    const existing = await store.collection('aiProviders').findOne(filter);
    const credential = input.apiKey.trim()
      ? encryptSecret(input.apiKey.trim())
      : existing?.credential;
    if (!credential) throw failure('Enter an API key for this provider.');
    const record = {
      ...filter,
      model: input.model,
      instructions: input.instructions,
      maxOutputTokens: input.maxOutputTokens,
      reasoning: input.reasoning,
      enabled: input.enabled,
      credential,
      updatedAt: new Date(),
    };
    await store.collection('aiProviders').updateOne(filter, { $set: record }, { upsert: true });
    if (input.isDefault)
      await store
        .collection('aiPreferences')
        .updateOne(
          { ownerId: user.id, workspaceId: user.workspaceId },
          { $set: { provider: input.provider } },
          { upsert: true },
        );
    else
      await store
        .collection('aiPreferences')
        .deleteOne({ ownerId: user.id, workspaceId: user.workspaceId, provider: input.provider });
    return safeAIProvider(record);
  }
  async function active(user) {
    const preference = await store
      .collection('aiPreferences')
      .findOne({ ownerId: user.id, workspaceId: user.workspaceId });
    return preference
      ? store.collection('aiProviders').findOne({
          ownerId: user.id,
          workspaceId: user.workspaceId,
          provider: preference.provider,
          enabled: true,
        })
      : null;
  }
  return { settings, save, active };
}
