import { LabelMirror } from '@mailops/schema';
import { mirrorLabels, requireEngine } from '@/lib/engine-store';
import { handle, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  const ctx = await requireEngine(request);
  return mirrorLabels(ctx, LabelMirror.parse(await readJson(request)).labels);
});
