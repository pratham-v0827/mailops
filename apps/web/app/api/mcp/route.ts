import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/http';
import { handleRpc } from '@/lib/mcp';
import { requireMcp } from '@/lib/mcp-tokens';

export const dynamic = 'force-dynamic';

/** Where an MCP client finds how to get a token (OAuth protected resource metadata, RFC 9728). */
function resourceMetadataUrl(request: Request) {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource`;
}

/** MCP over Streamable HTTP (stateless: every POST carries one JSON-RPC message or a batch). */
export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireMcp(request);
  } catch (e) {
    const message = e instanceof HttpError ? e.message : 'Unauthorized';
    return NextResponse.json(
      { error: 'invalid_token', error_description: message },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl(request)}"`,
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 },
    );
  }

  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0 || messages.length > 20) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } },
      { status: 400 },
    );
  }
  const results = (
    await Promise.all(
      messages.map((m) =>
        m && typeof m === 'object' && (m as { jsonrpc?: string }).jsonrpc === '2.0'
          ? handleRpc(auth, m as Parameters<typeof handleRpc>[1])
          : Promise.resolve({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32600, message: 'Invalid request' },
            }),
      ),
    )
  ).filter((r) => r !== null);

  if (results.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? results : results[0]);
}

/** No server-initiated stream: this server only answers requests. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
