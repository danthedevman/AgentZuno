/** @deprecated Legacy routing label. Use trigger.departmentId for a configured department. */
export type Department = string;
export type WorkflowStep =
  | {
      id: string;
      action: 'task.create';
      params: { queueName: string; title: string; description: string };
    }
  | { id: string; action: 'route' | 'handoff'; params: { queueName: string } }
  | {
      id: string;
      action: 'approval';
      params: {
        reason: string;
        requireRejectionComment?: boolean;
        target?: 'user' | 'group' | 'manager';
        userId?: string;
        groupId?: string;
      };
      requireRejectionComment?: boolean;
      when?: { departmentIds?: string[]; fieldId?: string; values?: (string | boolean)[] };
    }
  | {
      id: string;
      action: 'servicenow.createIncident';
      params: { assignmentGroup: string; shortDescription: string };
    }
  | { id: string; action: 'slack.postMessage'; params: { channel: string; text: string } }
  | {
      id: string;
      action: 'jira.createIssue';
      params: { project: string; issueType: string; summary: string };
    };
export interface WorkflowDefinition {
  displayInCatalog?: boolean;
  settings?: {
    description?: string;
    category?: string;
    catalogIcon?: string;
    catalogImageId?: string;
    submissionMessage?: string;
    timeoutSeconds?: number;
    maxConcurrentRuns?: number;
  };
  version: 1;
  name: string;
  trigger: { departmentId?: string; department?: Department; phrases: string[] };
  steps: WorkflowStep[];
  form?: RequestForm;
  routing?: RoutingRule[];
  permissions?: WorkflowPermissions;
}
export interface RequestForm {
  title: string;
  fields: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'boolean' | 'reference';
    required: boolean;
    options?: string[];
    referenceTable?: string;
  }>;
}
export function defineRequestForm(input: RequestForm): RequestForm;
export function validateFormAnswers(
  input: RequestForm,
  answers: Record<string, string | boolean>,
): Array<{ id: string; label: string; value: string | boolean }>;
export interface WorkflowEvent {
  id: string;
  workspaceId: string;
  department?: Department;
  departmentId?: string;
  text: string;
  answers?: Record<string, string | boolean>;
}
export interface StepContext {
  workflow: WorkflowDefinition;
  event: WorkflowEvent;
  step: WorkflowStep;
}
export interface WorkflowContext {
  actor?: { id: string; role?: string; queues?: string[] };
  mode?: 'dry-run' | 'execute';
  workflowId?: string;
  revision?: string;
  authorize(context: StepContext): Promise<boolean> | boolean;
  approve?(context: StepContext): Promise<boolean> | boolean;
  audit?(event: {
    key: string;
    action: WorkflowStep['action'];
    status: 'started' | 'completed' | 'failed';
  }): Promise<void>;
  executeOnce?(key: string, execute: () => Promise<unknown>): Promise<unknown>;
  actions?: Partial<
    Record<
      WorkflowStep['action'],
      (input: {
        params: WorkflowStep['params'];
        event: WorkflowEvent;
        idempotencyKey: string;
      }) => Promise<unknown>
    >
  >;
}
export function defineWorkflow(input: ExecutableWorkflow): ExecutableWorkflow;
export function defineWorkflow(input: WorkflowDefinition): WorkflowDefinition;
export function matchesWorkflow(input: WorkflowDefinition, event: WorkflowEvent): boolean;
export function toTypeScript(input: WorkflowDefinition): string;
export function isExternalAction(action: string): boolean;
export const workflowActions: WorkflowStep['action'][];
export function runWorkflow(
  input: WorkflowDefinition,
  event: WorkflowEvent,
  context: WorkflowContext,
): Promise<{
  status: 'not-matched' | 'planned' | 'completed';
  steps: Array<{ id: string; action: WorkflowStep['action']; status: 'planned' | 'completed' }>;
}>;

export interface RoutingRule {
  id: string;
  match: 'all' | 'any';
  conditions: Array<{
    fieldId: string;
    operator: 'equals' | 'not-equals';
    value: string | boolean;
  }>;
  action: 'route' | 'handoff';
  queueName: string;
}
export function defineRouting(rules: RoutingRule[], form: RequestForm): RoutingRule[];
export function resolveWorkflowRouting(
  input: WorkflowDefinition,
  answers: Record<string, string | boolean>,
): { ruleId: string | null; action: 'route' | 'handoff'; queueName: string };

export interface WorkflowPermissions {
  audience: 'workspace' | 'restricted';
  userIds: string[];
  queueNames: string[];
}
export function defineWorkflowPermissions(input: WorkflowPermissions): WorkflowPermissions;
export function canUseWorkflow(
  input: { permissions?: WorkflowPermissions },
  actor?: { id: string; role?: string; queues?: string[] },
): boolean;

export interface ExecutionContext {
  readonly requester: Readonly<{
    id?: string;
    departmentId?: string;
    department?: string;
    managerId?: string;
  }>;
  readonly answers: Readonly<Record<string, string | boolean>>;
  readonly request: Readonly<{ id?: string; number: string; title: string }>;
  route(id: string, queueName: string): Promise<{ queueName: string }>;
  handoff(id: string, queueName: string): Promise<{ queueName: string }>;
  approval(
    id: string,
    options: {
      userId?: string;
      groupId?: string;
      target?: 'user' | 'group' | 'manager';
      reason: string;
    },
  ): Promise<{ approved: boolean }>;
  readonly slack: {
    postMessage(
      id: string,
      options: { channel: string; text: string },
    ): Promise<{ messageId: string }>;
  };
  readonly tasks: {
    create(
      id: string,
      options: { queueName: string; title: string; description: string },
    ): Promise<{ id: string }>;
  };
}
export interface ExecutableWorkflow extends WorkflowDefinition {
  run(context: ExecutionContext): Promise<void>;
}
