import { FilterMirror } from '@mailops/schema';
import { mirrorFilters, requireEngine } from '@/lib/engine-store';
import { handle, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  const ctx = await requireEngine(request);
  const body = FilterMirror.parse(await readJson(request));
  return mirrorFilters(ctx, body.filters, body.complete);
});
