export function workflowChatText(text = '') {
  // An unfinished fence must stay hidden while the provider streams its definition.
  return text
    .replace(/```[^\n]*\n?[\s\S]*?(?:```|$)/g, '')
    .replace(/(?:^|\n)\s*\{[\s\S]*$/, '')
    .replace(/(?:^|\n)\s*(?:import\s|export\s)[\s\S]*$/, '')
    .trim();
}
