import { describe, expect, it } from 'vitest';
import { handleRpc, SUPPORTED_PROTOCOL_VERSIONS, TOOLS } from './mcp';

const readOnly = { uid: 'u1', scopes: ['read' as const], tokenId: 't' };
const full = { uid: 'u1', scopes: ['read' as const, 'propose' as const], tokenId: 't' };

describe('MCP server', () => {
  it('negotiates the protocol version', async () => {
    const r = (await handleRpc(full, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })) as { result: { protocolVersion: string; capabilities: object } };
    expect(r.result.protocolVersion).toBe('2025-06-18');
    const r2 = (await handleRpc(full, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    })) as { result: { protocolVersion: string } };
    expect(r2.result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it('lists only the tools the token may use, with JSON schemas', async () => {
    const r = (await handleRpc(readOnly, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toContain('list_rules');
    expect(names.some((n) => n.startsWith('propose_'))).toBe(false);
    expect(r.result.tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
  });

  it('exposes no tool that approves, deletes or enables production', () => {
    for (const t of TOOLS)
      expect(t.name).not.toMatch(/approve|delete|remove|enable|production|trash/);
  });

  it('refuses propose tools without the propose scope', async () => {
    const r = (await handleRpc(readOnly, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'propose_dry_run', arguments: { mailbox: 'me@gmail.com' } },
    })) as { result: { isError: boolean } };
    expect(r.result.isError).toBe(true);
  });

  it('validates arguments before touching data', async () => {
    const r = (await handleRpc(full, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'propose_rule', arguments: { mailbox: 'x', rule: { label: '/bad/' } } },
    })) as { result: { isError: boolean } };
    expect(r.result.isError).toBe(true);
  });

  it('ignores notifications and rejects unknown methods', async () => {
    expect(
      await handleRpc(full, { jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull();
    const r = (await handleRpc(full, { jsonrpc: '2.0', id: 5, method: 'resources/list' })) as {
      error: { code: number };
    };
    expect(r.error.code).toBe(-32601);
  });
});
