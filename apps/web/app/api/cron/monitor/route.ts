import { NextResponse } from 'next/server';
import { checkStaleEngines } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

/** Vercel Cron (daily). Vercel sends `Authorization: Bearer $CRON_SECRET`; without it, nothing runs. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ stale: await checkStaleEngines() });
}
