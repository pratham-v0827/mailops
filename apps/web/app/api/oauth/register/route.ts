import { ClientRegistration, registerClient } from '@/lib/oauth';
import { json, preflight } from '../cors';

export const dynamic = 'force-dynamic';

/** Dynamic client registration (RFC 7591), public clients only. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400);
  }
  const parsed = ClientRegistration.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_redirect_uri',
        error_description: parsed.error.issues.map((i) => i.message).join('; '),
      },
      400,
    );
  }
  return json(await registerClient(parsed.data), 201);
}
export const OPTIONS = preflight;
