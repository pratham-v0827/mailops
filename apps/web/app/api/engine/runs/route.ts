import { EngineRunReport } from '@mailops/schema';
import { recordRun, requireEngine } from '../../../../lib/engine-store';
import { handle, readJson } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** The engine reports one run (counts only, never email content). */
export const POST = handle(async (request: Request) => {
  const ctx = await requireEngine(request);
  return recordRun(ctx, EngineRunReport.parse(await readJson(request)));
});
