import { api } from './client';

export interface AgentConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentRequest {
  message: string;
  history?: AgentConversationMessage[];
}

export interface AgentResponse {
  message:       string;
  summary?:      Record<string, unknown>;
  items?:        unknown[];
  actions_taken: string[];
  suggestions?:  string[];
  errors:        string[];
  tools_used?:   string[];
  job_id?:       string;
}

export const agentApi = {
  chat: (req: AgentRequest) =>
    api.post<AgentResponse>('/api/ai/agent', req),

  getLogs: () =>
    api.get<{ logs: unknown[] }>('/api/ai/agent/logs'),
};
