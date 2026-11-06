const failure = (message) =>
  Object.assign(new Error(message), { status: 422, publicMessage: message });
export function providerTools(provider, tools) {
  if (provider === 'openai')
    return tools.map(({ name, description, parameters }) => ({
      type: 'function',
      name,
      description,
      parameters,
      strict: true,
    }));
  if (provider === 'anthropic')
    return tools.map(({ name, description, parameters }) => ({
      name,
      description,
      input_schema: parameters,
    }));
  return [
    {
      functionDeclarations: tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parametersJsonSchema: parameters,
      })),
    },
  ];
}
export function readToolCalls(provider, result) {
  const items =
    provider === 'openai'
      ? (result.output || [])
          .filter((item) => item.type === 'function_call')
          .map((item) => ({ id: item.call_id, name: item.name, arguments: item.arguments }))
      : provider === 'anthropic'
        ? (result.content || [])
            .filter((item) => item.type === 'tool_use')
            .map((item) => ({ id: item.id, name: item.name, arguments: item.input }))
        : (result.candidates?.[0]?.content?.parts || [])
            .filter((part) => part.functionCall)
            .map((part, index) => ({
              id: part.functionCall.id || `google-${index}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args,
            }));
  if (items.length > 8)
    throw failure('The agent requested too many actions. Split the request into smaller steps.');
  for (const item of items) {
    if (
      typeof item.id !== 'string' ||
      item.id.length > 200 ||
      typeof item.name !== 'string' ||
      item.name.length > 80
    )
      throw failure('The provider returned an invalid action.');
    if (typeof item.arguments === 'string') {
      if (item.arguments.length > 250000)
        throw failure('The provider returned an oversized action.');
      try {
        item.arguments = JSON.parse(item.arguments);
      } catch {
        throw failure('The provider returned invalid action details.');
      }
    }
  }
  return items;
}
export function toolTurns(provider, raw, results) {
  if (provider === 'openai')
    return [
      ...(raw.output || []),
      ...results.map(({ call, result }) => ({
        type: 'function_call_output',
        call_id: call.id,
        output: JSON.stringify(result),
      })),
    ];
  if (provider === 'anthropic')
    return [
      { role: 'assistant', content: raw.content },
      {
        role: 'user',
        content: results.map(({ call, result }) => ({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result),
        })),
      },
    ];
  return [
    { role: 'model', parts: raw.candidates[0].content.parts },
    {
      role: 'user',
      parts: results.map(({ call, result }) => ({
        functionResponse: {
          name: call.name,
          ...(call.id.startsWith('google-') ? {} : { id: call.id }),
          response: result,
        },
      })),
    },
  ];
}
