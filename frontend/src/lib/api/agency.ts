import { api } from './client';
import type {
  AgencyClientCoverage,
  AgencyLog,
  AgencyOverview,
  AgencySkill,
  AgencyTimelineItem,
  AgentDefinition,
  AgentFinding,
  AgentRun,
  AgentTask,
  HarnessFlowStep,
} from '../types';

export interface CreateAgentTaskParams {
  agent_slug: string;
  client_id?: string | null;
  title: string;
  priority?: 'low' | 'medium' | 'high';
  input_json?: Record<string, unknown> | null;
}

export const agencyApi = {
  overview: () =>
    api.get<AgencyOverview>('/api/agency/overview'),

  agents: () =>
    api.get<{ agents: AgentDefinition[] }>('/api/agency/agents'),

  runs: () =>
    api.get<{ runs: AgentRun[] }>('/api/agency/runs'),

  tasks: () =>
    api.get<{ tasks: AgentTask[] }>('/api/agency/tasks'),

  task: (id: string) =>
    api.get<{ task: AgentTask }>(`/api/agency/tasks/${id}`),

  createTask: (params: CreateAgentTaskParams) =>
    api.post<{ ok: boolean; task: AgentTask }>('/api/agency/tasks', params),

  runAgent: (slug: string) =>
    api.post<{ ok: boolean; task_id: string; approved_job_id: string; command_name: string }>(`/api/agency/agents/${slug}/run`, {}),

  retryTask: (id: string) =>
    api.post<{ ok: boolean; task_id: string; approved_job_id: string; command_name: string }>(`/api/agency/tasks/${id}/retry`, {}),

  markReviewed: (id: string) =>
    api.post<{ ok: boolean; task: AgentTask }>(`/api/agency/tasks/${id}/reviewed`, {}),

  findings: () =>
    api.get<{ findings: AgentFinding[] }>('/api/agency/findings'),

  acknowledgeFinding: (id: string) =>
    api.post<{ ok: boolean }>(`/api/agency/findings/${id}/acknowledge`, {}),

  clientCoverage: () =>
    api.get<{ clients: AgencyClientCoverage[] }>('/api/agency/client-coverage'),

  timeline: () =>
    api.get<{ items: AgencyTimelineItem[] }>('/api/agency/timeline'),

  logs: () =>
    api.get<{ logs: AgencyLog[] }>('/api/agency/logs'),

  skills: () =>
    api.get<{ skills: AgencySkill[] }>('/api/agency/skills'),

  harnessFlow: () =>
    api.get<{ steps: HarnessFlowStep[] }>('/api/agency/harness-flow'),
};
