import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import ts from 'typescript';
import { getQuickJS } from 'quickjs-emscripten';
const pending = new Map();
let runtime;
let context;
let sequence = 0;
let resultHandle;
function finish(message) {
  parentPort.postMessage(message);
  for (const promise of pending.values()) promise.dispose();
  pending.clear();
  resultHandle?.dispose();
  context?.dispose();
  runtime?.dispose();
  parentPort.close();
}
function pump() {
  const jobs = runtime.executePendingJobs(100);
  if (jobs.error) {
    jobs.error.dispose();
    throw new Error('Workflow execution failed.');
  }
  const result = context.getPromiseState(resultHandle);
  if (result.type === 'fulfilled') {
    result.value.dispose();
    finish({ type: 'done' });
  } else if (result.type === 'rejected') {
    const message = context.dump(result.error)?.message;
    result.error.dispose();
    finish({
      type: 'error',
      message: message === 'WORKFLOW_PAUSED' ? message : 'Workflow execution failed.',
    });
  }
}
try {
  const source = ts.createSourceFile(
    'workflow.ts',
    workerData.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier.text !== '@agentzuno/workflows'
    )
      throw new Error('Only the Zuno workflow SDK can be imported.');
  }
  const filename = '/workflow.ts';
  const sdkFilename = '/workflow-sdk.d.ts';
  const sdkTypes = readFileSync(new URL('../sdk/workflows/index.d.ts', import.meta.url), 'utf8');
  const options = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2020.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = (name) =>
    name === filename ? workerData.source : name === sdkFilename ? sdkTypes : read(name);
  const exists = host.fileExists.bind(host);
  host.fileExists = (name) => [filename, sdkFilename].includes(name) || exists(name);
  host.resolveModuleNames = (names) =>
    names.map((name) =>
      name === '@agentzuno/workflows'
        ? { resolvedFileName: sdkFilename, extension: ts.Extension.Dts }
        : undefined,
    );
  const program = ts.createProgram([filename], options, host);
  const diagnostic = ts
    .getPreEmitDiagnostics(program)
    .find((item) => item.category === ts.DiagnosticCategory.Error);
  if (diagnostic)
    throw new Error(
      'TypeScript: ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').slice(0, 500),
    );
  const compiled = ts.transpileModule(workerData.source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error))
    throw new Error('TypeScript contains a syntax error.');
  const QuickJS = await getQuickJS();
  runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline =
    Date.now() + Math.min(55000, Math.max(4500, (workerData.timeoutMs || 60000) - 500));
  let interruptCount = 0;
  runtime.setInterruptHandler(() => Date.now() > deadline || ++interruptCount > 1000);
  context = runtime.newContext();
  const bridge = context.newFunction('__dispatch', (action, id, input) => {
    if (pending.size) throw new Error('Await each workflow action before starting another.');
    const promise = context.newPromise();
    const call = ++sequence;
    if (call > 50) {
      promise.dispose();
      throw new Error('Workflow step limit exceeded.');
    }
    pending.set(call, promise);
    parentPort.postMessage({
      type: 'action',
      call,
      action: context.getString(action),
      id: context.getString(id),
      input: context.dump(input),
    });
    return promise.handle;
  });
  context.setProp(context.global, '__dispatch', bridge);
  bridge.dispose();
  const setup = `
    globalThis.exports = {};
    globalThis.require = (name) => {
      if (name !== '@agentzuno/workflows') throw new Error('Import denied');
      return { defineWorkflow: (value) => value };
    };
    globalThis.Date = undefined;
    Math.random = () => { throw new Error('Randomness is not supported'); };
  `;
  const initialized = context.evalCode(setup + '\n' + compiled.outputText);
  if (initialized.error) {
    initialized.error.dispose();
    throw new Error('Workflow code could not be loaded.');
  }
  initialized.value.dispose();
  if (workerData.mode === 'inspect') {
    const manifest = context.evalCode(
      `JSON.stringify(exports.default, (key, value) => key === 'run' ? undefined : value)`,
    );
    if (manifest.error) {
      manifest.error.dispose();
      throw new Error('Export a workflow with defineWorkflow.');
    }
    const definition = JSON.parse(context.getString(manifest.value));
    manifest.value.dispose();
    const hasRun = context.evalCode(`typeof exports.default.run === 'function'`);
    const valid = context.dump(hasRun.value);
    hasRun.value.dispose();
    if (!valid) throw new Error('The workflow needs an async run(ctx) function.');
    finish({ type: 'manifest', definition });
  } else {
    const input = JSON.stringify(workerData.input).replace(/</g, '\\u003c');
    const execution = context.evalCode(`
      (() => {
        const input = ${input};
        const invoke = async (action, id, args) => {
          const result = await __dispatch(action, id, args);
          if (result.paused) throw new Error('WORKFLOW_PAUSED');
          if (result.error) throw new Error('Action failed');
          return result.value;
        };
        const ctx = Object.freeze({
          requester: Object.freeze(input.requester || {}),
          answers: Object.freeze(input.answers || {}),
          request: Object.freeze(input.request || {}),
          route: (id, queueName) => invoke('route', id, { queueName }),
          handoff: (id, queueName) => invoke('handoff', id, { queueName }),
          approval: (id, options) => invoke('approval', id, options),
          slack: Object.freeze({ postMessage: (id, options) => invoke('slack.postMessage', id, options) })
        });
        return exports.default.run(ctx);
      })()
    `);
    if (execution.error) {
      execution.error.dispose();
      throw new Error('Workflow execution failed.');
    }
    resultHandle = execution.value;
    parentPort.on('message', (message) => {
      try {
        const promise = pending.get(message.call);
        if (!promise) return;
        const value = context.unwrapResult(context.evalCode(`(${JSON.stringify(message.result)})`));
        promise.resolve(value);
        value.dispose();
        promise.dispose();
        pending.delete(message.call);
        pump();
      } catch {
        finish({ type: 'error', message: 'Workflow execution failed.' });
      }
    });
    pump();
  }
} catch (error) {
  finish({ type: 'error', message: error.message });
}
