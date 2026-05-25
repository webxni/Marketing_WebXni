import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WebXniWorkerAgentClient } from './worker-client.js';

const workerBaseUrl = process.env.WEBXNI_WORKER_BASE_URL?.trim() || 'https://marketing.webxni.com';
const agentToken = process.env.WEBXNI_AGENT_INTERNAL_TOKEN?.trim() || process.env.AGENT_INTERNAL_TOKEN?.trim();

if (!agentToken) {
  throw new Error('WEBXNI_AGENT_INTERNAL_TOKEN or AGENT_INTERNAL_TOKEN is required');
}

const client = new WebXniWorkerAgentClient({
  baseUrl: workerBaseUrl,
  bearerToken: agentToken,
});

const checkSystemHealthSchema = z.object({
  lookback_hours: z.number().int().min(1).max(24 * 30).optional(),
  stale_user_days: z.number().int().min(1).max(365).optional(),
});

const runWeeklyMarketingPipelineSchema = z.object({
  period_start: z.string().min(10),
  period_end: z.string().min(10),
  client_slugs: z.array(z.string().min(1)).optional(),
  overwrite_existing: z.boolean().optional(),
  publish_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  provider: z.enum(['openai', 'claude']).optional(),
  force: z.boolean().optional(),
});

const dispatchClientReportsSchema = z.object({
  from: z.string().min(10),
  to: z.string().min(10),
  client_slugs: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

const sendHeartbeatNotificationSchema = z.object({
  status: z.enum(['ok', 'warning', 'error']).optional(),
  title: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  dedupe_key: z.string().min(1).optional(),
  fields: z.array(z.object({
    name: z.string().min(1),
    value: z.string().min(1),
    inline: z.boolean().optional(),
  })).max(10).optional(),
});

const runMarketingAgentSchema = z.object({
  message: z.string().min(1),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1),
  })).max(12).optional(),
});

const executeMarketingToolSchema = z.object({
  tool_name: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});

const server = new Server(
  {
    name: 'webxni-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_marketing_agent',
      description: 'Ejecuta al agente completo de WebXni con acceso autónomo a estrategia de clientes, topics, generación de posts, blog posts, publicación WordPress e imágenes vía Stability/OpenAI.',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          history: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' },
              },
            },
          },
        },
      },
    },
    {
      name: 'execute_marketing_tool',
      description: 'Ejecuta una herramienta interna concreta del agente sin pasar por un planner. Útil para operación determinística desde Claude/Codex. Ejemplos de tool_name: get_client_details, update_client_intelligence, add_client_topics, create_content_with_image, batch_create_content, publish_blog, create_content_request, generate_content.',
      inputSchema: {
        type: 'object',
        required: ['tool_name'],
        properties: {
          tool_name: { type: 'string' },
          args: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: 'check_system_health',
      description: 'Audita errores recientes de generación, cola aprobada de Claude y señales básicas de seguridad/autenticación.',
      inputSchema: {
        type: 'object',
        properties: {
          lookback_hours: { type: 'integer', minimum: 1, maximum: 720 },
          stale_user_days: { type: 'integer', minimum: 1, maximum: 365 },
        },
      },
    },
    {
      name: 'run_weekly_marketing_pipeline',
      description: 'Encola la generación semanal usando la orquestación existente de generation_runs y approved_command_jobs.',
      inputSchema: {
        type: 'object',
        required: ['period_start', 'period_end'],
        properties: {
          period_start: { type: 'string' },
          period_end: { type: 'string' },
          client_slugs: { type: 'array', items: { type: 'string' } },
          overwrite_existing: { type: 'boolean' },
          publish_time: { type: 'string' },
          provider: { type: 'string', enum: ['openai', 'claude'] },
          force: { type: 'boolean' },
        },
      },
    },
    {
      name: 'dispatch_client_reports',
      description: 'Compila resúmenes de performance por cliente para un rango semanal y devuelve el paquete estructurado.',
      inputSchema: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          client_slugs: { type: 'array', items: { type: 'string' } },
          force: { type: 'boolean' },
        },
      },
    },
    {
      name: 'send_heartbeat_notification',
      description: 'Envía un heartbeat o alerta al canal operativo de Discord usando un dedupe key auditable.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'warning', 'error'] },
          title: { type: 'string' },
          message: { type: 'string' },
          dedupe_key: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'value'],
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
                inline: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  switch (name) {
    case 'run_marketing_agent': {
      const input = runMarketingAgentSchema.parse(rawArgs ?? {});
      const result = await client.runMarketingAgent(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'execute_marketing_tool': {
      const input = executeMarketingToolSchema.parse(rawArgs ?? {});
      const result = await client.executeMarketingTool(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'check_system_health': {
      const input = checkSystemHealthSchema.parse(rawArgs ?? {});
      const result = await client.checkSystemHealth(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'run_weekly_marketing_pipeline': {
      const input = runWeeklyMarketingPipelineSchema.parse(rawArgs ?? {});
      const result = await client.runWeeklyMarketingPipeline(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'dispatch_client_reports': {
      const input = dispatchClientReportsSchema.parse(rawArgs ?? {});
      const result = await client.dispatchClientReports(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'send_heartbeat_notification': {
      const input = sendHeartbeatNotificationSchema.parse(rawArgs ?? {});
      const result = await client.sendHeartbeatNotification(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
