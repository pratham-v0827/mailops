import { exchangeToken, OAuthError } from '@/lib/oauth';
import { json, preflight } from '../cors';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let form: URLSearchParams;
  const type = request.headers.get('content-type') ?? '';
  try {
    form = type.includes('application/json')
      ? new URLSearchParams((await request.json()) as Record<string, string>)
      : new URLSearchParams(await request.text());
  } catch {
    return json({ error: 'invalid_request', error_description: 'Unreadable body' }, 400);
  }
  try {
    return json(await exchangeToken(form));
  } catch (e) {
    if (e instanceof OAuthError)
      return json({ error: e.error, error_description: e.message }, e.status);
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
}
export const OPTIONS = preflight;
