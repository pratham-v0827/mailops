import { EngineHeartbeat } from '@mailops/schema';
import { recordHeartbeat, requireEngine } from '../../../../lib/engine-store';
import { handle, readJson } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** The engine checks in; this also verifies it runs in the mailbox's own Gmail account. */
export const POST = handle(async (request: Request) => {
  const ctx = await requireEngine(request);
  return recordHeartbeat(ctx, EngineHeartbeat.parse(await readJson(request)));
});
