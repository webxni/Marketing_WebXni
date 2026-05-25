import type {
  CheckSystemHealthInput,
  DispatchClientReportsInput,
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
    return this.post('/internal/agent/check-system-health', input);
  }

  runWeeklyMarketingPipeline(input: RunWeeklyMarketingPipelineInput) {
    return this.post('/internal/agent/run-weekly-marketing-pipeline', input);
  }

  dispatchClientReports(input: DispatchClientReportsInput) {
    return this.post('/internal/agent/dispatch-client-reports', input);
  }

  sendHeartbeatNotification(input: SendHeartbeatNotificationInput) {
    return this.post('/internal/agent/send-heartbeat-notification', input);
  }
}
