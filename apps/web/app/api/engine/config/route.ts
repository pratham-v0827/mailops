import { engineConfig, requireEngine } from '../../../../lib/engine-store';
import { handle } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** The engine pulls its mailbox's settings and rules. */
export const GET = handle(async (request: Request) => engineConfig(await requireEngine(request)));
