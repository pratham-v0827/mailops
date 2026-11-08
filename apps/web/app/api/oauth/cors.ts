import { NextResponse } from 'next/server';

/** OAuth discovery, registration and token endpoints may be called from browsers (MCP inspectors). */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS, 'Cache-Control': 'no-store', ...extra },
  });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
