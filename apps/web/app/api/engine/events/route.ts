import { EngineEventBatch } from '@mailops/schema';
import { recordEvents, requireEngine } from '@/lib/engine-store';
import { handle, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Audit events from a run: one per archive / trash / protect decision. */
export const POST = handle(async (request: Request) => {
  const ctx = await requireEngine(request);
  return recordEvents(ctx, EngineEventBatch.parse(await readJson(request)).events);
});
