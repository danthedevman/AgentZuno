import { readFile } from 'node:fs/promises';
import { inspectWorkflowSource, runSandbox } from '../src/workflowRuntime.js';
import { validateFormAnswers } from '../sdk/workflows/index.js';
const [, , filename, answersFile] = process.argv;
if (!filename) throw new Error('Usage: npm run workflow:test -- workflow.ts [answers.json]');
const source = await readFile(filename, 'utf8');
const definition = await inspectWorkflowSource(source);
const answers = answersFile ? JSON.parse(await readFile(answersFile, 'utf8')) : {};
if (definition.form) validateFormAnswers(definition.form, answers);
const steps = [];
await runSandbox(source, {
  input: { answers, request: { number: 'TEST', title: definition.name } },
  action: async ({ id, action, input }) => {
    steps.push({ id, action, input, status: 'Simulated' });
    return action === 'approval' ? { approved: true } : {};
  },
});
console.log(
  JSON.stringify(
    {
      status: 'Simulated',
      steps,
      effects:
        'No live actions performed. Server publishing additionally enforces queue, permission and connector checks.',
    },
    null,
    2,
  ),
);
