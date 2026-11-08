import { getClient } from '@/lib/oauth';
import { handle, HttpError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Public info about a registered client, for the consent screen. */
export const GET = handle(async (request: Request) => {
  const client = await getClient(new URL(request.url).searchParams.get('client_id') ?? '');
  if (!client) throw new HttpError(404, 'Unknown client');
  return { name: client.name, redirectUris: client.redirectUris };
});
