import { authServerMetadata } from '@/lib/oauth';
import { json, preflight } from '../cors';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return json(authServerMetadata(new URL(request.url).origin));
}
export const OPTIONS = preflight;
