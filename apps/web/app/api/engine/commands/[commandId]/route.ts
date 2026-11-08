import { CommandResult } from '@mailops/schema';
import { completeCommand, requireEngine } from '@/lib/engine-store';
import { handle, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ commandId: string }> };

/** The engine reports the result of one command. */
export const POST = handle(async (request: Request, { params }: Params) => {
  const ctx = await requireEngine(request);
  const { commandId } = await params;
  return completeCommand(ctx, commandId, CommandResult.parse(await readJson(request)));
});
