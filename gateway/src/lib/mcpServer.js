/**
 * MCP over Streamable HTTP, stateless (docs/MCP.md): one JSON-RPC message per POST, answered with one JSON response;
 * no server-sent stream, no sessions. Methods: initialize, ping, tools/list, tools/call; notifications get 202.
 */
import { transaction } from './db.js';
import { toolByName, toolInfo, toolsFor } from './mcpTools.js';
import { raw, t } from './i18n.js';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * Handle one message. ctx: { userId, tz, language, token: { id, name, scope }, version, log, audit(entry) }.
 * Returns { status, body } (body null for notifications).
 */
export async function handleMcp(msg, ctx) {
  if (Array.isArray(msg)) return { status: 400, body: rpcError(null, -32600, 'batches are not supported') };
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { status: 400, body: rpcError(msg?.id, -32600, 'invalid request') };
  const { id, method, params = {} } = msg;
  if (id === undefined) return { status: 202, body: null }; // notifications (initialized, cancelled): nothing to answer

  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    await ctx.audit({ method, ok: true });
    return {
      status: 200,
      body: rpc(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'medcontrol', title: t(ctx.language, 'notify.appName'), version: ctx.version || '0' },
        instructions: raw(ctx.language, 'mcp.instructions'),
      }),
    };
  }
  if (method === 'ping') return { status: 200, body: rpc(id, {}) };
  if (method === 'tools/list') {
    await ctx.audit({ method, ok: true });
    return { status: 200, body: rpc(id, { tools: toolsFor(ctx.token.scope).map((tool) => ({ name: tool.name, ...toolInfo(tool, ctx.language), annotations: { readOnlyHint: tool.scope === 'read' } })) }) };
  }
  if (method === 'tools/call') {
    const name = String(params?.name || '');
    const tool = toolByName(name);
    if (!tool || !toolsFor(ctx.token.scope).includes(tool)) {
      await ctx.audit({ method, tool: name.slice(0, 60), ok: false, detail: tool ? 'scope' : 'unknown_tool' });
      return { status: 200, body: rpcError(id, -32602, tool ? 'this token may only read' : `unknown tool ${name}`) };
    }
    const parsed = tool.args.safeParse(params?.arguments ?? {});
    if (!parsed.success) {
      await ctx.audit({ method, tool: name, ok: false, detail: 'invalid_arguments' });
      return { status: 200, body: rpcError(id, -32602, `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`) };
    }
    try {
      let auditedWrite = false;
      const transact = (write) => transaction(async (client) => {
        const value = await write(client);
        await ctx.audit({ method, tool: name, ok: true }, client);
        auditedWrite = true;
        return value;
      });
      const data = await tool.run(ctx.userId, parsed.data, { tz: ctx.tz, language: ctx.language, tokenName: ctx.token.name, transact });
      if (!auditedWrite) await ctx.audit({ method, tool: name, ok: data?.ok !== false, detail: data?.error });
      return { status: 200, body: rpc(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false }) };
    } catch (e) {
      ctx.log?.warn?.({ err: e.message, tool: name }, 'mcp tool failed');
      await ctx.audit({ method, tool: name, ok: false, detail: String(e.code || 'failed').slice(0, 40) });
      return { status: 200, body: rpc(id, { content: [{ type: 'text', text: t(ctx.language, 'mcp.error', { code: e.code || raw(ctx.language, 'mcp.failed') }) }], isError: true }) };
    }
  }
  await ctx.audit({ method: method.slice(0, 60), ok: false, detail: 'unknown_method' });
  return { status: 200, body: rpcError(id, -32601, `method not found: ${method}`) };
}
