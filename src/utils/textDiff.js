export function diffLines(before = '', after = '') {
  const oldLines = String(before).split('\n');
  const newLines = String(after).split('\n');
  const rows = [];
  let oldLine = 1,
    newLine = 1;
  const add = (type, text) =>
    rows.push({
      type,
      text,
      oldLine: type === 'add' ? null : oldLine++,
      newLine: type === 'remove' ? null : newLine++,
    });
  // Bound comparison work for large article bodies; retain every line in the fallback.
  if (oldLines.length * newLines.length > 64000) {
    let start = 0;
    while (
      start < oldLines.length &&
      start < newLines.length &&
      oldLines[start] === newLines[start]
    )
      add('context', oldLines[start++]);
    let end = 0;
    while (
      end < oldLines.length - start &&
      end < newLines.length - start &&
      oldLines.at(-end - 1) === newLines.at(-end - 1)
    )
      end++;
    oldLines.slice(start, oldLines.length - end).forEach((line) => add('remove', line));
    newLines.slice(start, newLines.length - end).forEach((line) => add('add', line));
    oldLines.slice(oldLines.length - end).forEach((line) => add('context', line));
    return rows;
  }
  const lengths = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint16Array(newLines.length + 1),
  );
  for (let i = oldLines.length - 1; i >= 0; i--)
    for (let j = newLines.length - 1; j >= 0; j--)
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  let i = 0,
    j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      add('context', oldLines[i++]);
      j++;
    } else if (
      i < oldLines.length &&
      (j === newLines.length || lengths[i + 1][j] >= lengths[i][j + 1])
    )
      add('remove', oldLines[i++]);
    else add('add', newLines[j++]);
  }
  return rows;
}

export function changedSections(sections) {
  return sections.filter((section) => String(section.before ?? '') !== String(section.after ?? ''));
}
