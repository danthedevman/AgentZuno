import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { defineWorkflow } from '../../sdk/workflows/index.js';
export function runSandbox(
  source,
  { mode = 'execute', input = {}, action, timeoutMs = 60000 } = {},
) {
  if (typeof source !== 'string' || !source.trim() || source.length > 40000)
    return Promise.reject(new Error('Workflow code must contain 1–40,000 characters.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workflowSandboxWorker.js', import.meta.url), {
      workerData: { source, mode, input, timeoutMs },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 2 },
    });
    let settled = false;
    let inFlight = false;
    let timedOut = false;
    let deferredError = null;
    let actionError = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        worker.terminate();
        if (!inFlight) finish(new Error('Workflow exceeded its execution time limit.'));
      },
      Math.max(5000, Math.min(60000, timeoutMs)),
    );
    worker.on('error', () => finish(new Error('Workflow sandbox failed.')));
    worker.on('exit', () => {
      if (!settled && !inFlight) finish(new Error('Workflow sandbox stopped.'));
    });
    worker.on('message', async (message) => {
      if (settled) return;
      if (message.type === 'error') {
        if (inFlight) {
          deferredError = actionError || new Error(message.message);
          worker.terminate();
        } else finish(actionError || new Error(message.message));
      } else if (message.type === 'manifest') finish(null, message.definition);
      else if (message.type === 'done') {
        if (inFlight) {
          deferredError = new Error('Await every workflow action.');
          worker.terminate();
        } else finish(null, { status: 'complete' });
      } else if (message.type === 'action') {
        try {
          if (inFlight) throw new Error('Run actions sequentially.');
          inFlight = true;
          const value = await action(message);
          if (!settled && !timedOut && !deferredError)
            worker.postMessage({ call: message.call, result: { value } });
        } catch (error) {
          actionError = error;
          if (!settled && !timedOut && !deferredError)
            worker.postMessage({
              call: message.call,
              result: error.paused ? { paused: true } : { error: true },
            });
        } finally {
          inFlight = false;
          if (deferredError) finish(deferredError);
          else if (timedOut) finish(new Error('Workflow exceeded its execution time limit.'));
        }
      }
    });
  });
}
export async function inspectWorkflowSource(source) {
  return defineWorkflow(await runSandbox(source, { mode: 'inspect' }));
}
export function updateWorkflowMetadata(source, definition) {
  const file = ts.createSourceFile(
    'workflow.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = file.statements.find(ts.isExportAssignment);
  const call = declaration?.expression;
  const object = call && ts.isCallExpression(call) && call.arguments[0];
  if (!object || !ts.isObjectLiteralExpression(object))
    throw new Error('Export defineWorkflow with an object literal.');
  const run = object.properties.find((property) => property.name?.getText(file) === 'run');
  if (!run) throw new Error('Keep the workflow run function.');
  const metadata = JSON.stringify(defineWorkflow(definition), null, 2);
  let runText = run.getText(file);
  const edits = [];
  const approvalCalls = new Set();
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['route', 'handoff'].includes(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const step = definition.steps.find(
        (item) => item.id === node.arguments[0].text && item.action === node.expression.name.text,
      );
      if (
        step &&
        node.arguments[1] &&
        ts.isStringLiteral(node.arguments[1]) &&
        node.arguments[1].text !== step.params.queueName
      )
        edits.push({
          start: node.arguments[1].getStart(file) - run.getStart(file),
          end: node.arguments[1].end - run.getStart(file),
          text: JSON.stringify(step.params.queueName),
        });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'approval' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      approvalCalls.add(node.arguments[0].text);
      const step = definition.steps.find(
        (item) => item.id === node.arguments[0].text && item.action === 'approval',
      );
      if (step?.params.target && node.arguments[1])
        edits.push({
          start: node.arguments[1].getStart(file) - run.getStart(file),
          end: node.arguments[1].end - run.getStart(file),
          text: JSON.stringify(step.params),
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(run);
  const addedApprovals = definition.steps.filter(
    (step) => step.action === 'approval' && !approvalCalls.has(step.id),
  );
  if (addedApprovals.length) {
    const body = run.body || run.initializer?.body;
    const parameter = run.parameters?.[0] || run.initializer?.parameters?.[0];
    if (!body || !ts.isBlock(body) || !parameter || !ts.isIdentifier(parameter.name))
      throw new Error('Use a block-bodied run function to add approval steps.');
    const code = addedApprovals
      .map(
        (step) =>
          `if (!(await ${parameter.name.text}.approval(${JSON.stringify(step.id)}, ${JSON.stringify(step.params)})).approved) return;`,
      )
      .join('\n');
    const position = body.getStart(file) - run.getStart(file) + 1;
    edits.push({ start: position, end: position, text: `\n${code}\n` });
  }

  for (const edit of edits.sort((a, b) => b.start - a.start))
    runText = runText.slice(0, edit.start) + edit.text + runText.slice(edit.end);
  const replacement = metadata.slice(0, -1) + ',\n' + runText + '\n}';
  return source.slice(0, object.getStart(file)) + replacement + source.slice(object.end);
}
