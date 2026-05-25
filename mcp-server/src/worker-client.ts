import type {
  CheckSystemHealthInput,
  DispatchClientReportsInput,
  ExecuteMarketingToolInput,
  RunMarketingAgentInput,
  RunWeeklyMarketingPipelineInput,
  SendHeartbeatNotificationInput,
  WorkerAgentRequestOptions,
} from './types.js';

export class WebXniWorkerAgentClient {
  constructor(private readonly options: WorkerAgentRequestOptions) {}

  private async post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.options.bearerToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${path} returned ${response.status}: ${text.slice(0, 500)}`);
    }

    return response.json() as Promise<TResponse>;
  }

  checkSystemHealth(input: CheckSystemHealthInput) {
    return this.post('/api/ai/mcp/execute-tool', {
      tool_name: 'get_system_status',
      args: input,
    });
  }

  runWeeklyMarketingPipeline(input: RunWeeklyMarketingPipelineInput) {
    return this.post('/api/ai/mcp/execute-tool', {
      tool_name: 'generate_content',
      args: {
        client_slugs: input.client_slugs ?? [],
        date_from: input.period_start,
        date_to: input.period_end,
        provider: input.provider,
      },
    });
  }

  dispatchClientReports(input: DispatchClientReportsInput) {
    return this.post('/api/ai/mcp/execute-tool', {
      tool_name: 'get_report',
      args: {
        client: input.client_slugs?.length === 1 ? input.client_slugs[0] : undefined,
        date_from: input.from,
        date_to: input.to,
      },
    });
  }

  sendHeartbeatNotification(input: SendHeartbeatNotificationInput) {
    return this.post('/api/ai/mcp/heartbeat', input);
  }

  runMarketingAgent(input: RunMarketingAgentInput) {
    return this.post('/api/ai/mcp/run', input);
  }

  executeMarketingTool(input: ExecuteMarketingToolInput) {
    return this.post('/api/ai/mcp/execute-tool', input);
  }
}
