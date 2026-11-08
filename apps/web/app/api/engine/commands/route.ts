import { requireEngine, takeCommands } from '@/lib/engine-store';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Commands waiting for this engine (create label/filter, start or stop a pass, refresh mirrors). */
export const GET = handle(async (request: Request) => takeCommands(await requireEngine(request)));
