import { protectedResourceMetadata } from '@/lib/oauth';
import { json, preflight } from '../cors';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return json(protectedResourceMetadata(new URL(request.url).origin));
}
export const OPTIONS = preflight;
