export interface WorkerAgentRequestOptions {
  baseUrl: string;
  bearerToken: string;
}

export interface CheckSystemHealthInput {
  lookback_hours?: number;
  stale_user_days?: number;
}

export interface RunWeeklyMarketingPipelineInput {
  period_start: string;
  period_end: string;
  client_slugs?: string[];
  overwrite_existing?: boolean;
  publish_time?: string;
  provider?: 'openai' | 'claude';
  force?: boolean;
}

export interface DispatchClientReportsInput {
  from: string;
  to: string;
  client_slugs?: string[];
  force?: boolean;
}

export interface SendHeartbeatNotificationInput {
  status?: 'ok' | 'warning' | 'error';
  title?: string;
  message?: string;
  dedupe_key?: string;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}
