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
  actions_taken: string[];
  data:          Record<string, unknown>;
  errors:        string[];
  tools_used:    string[];
}

export const agentApi = {
  chat: (req: AgentRequest) =>
    api.post<AgentResponse>('/api/ai/agent', req),

  getLogs: () =>
    api.get<{ logs: unknown[] }>('/api/ai/agent/logs'),
};
