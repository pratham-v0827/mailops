import { PairCode } from '@mailops/schema';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, readJson } from '@/lib/http';
import { approvePairing, describePairing } from '@/lib/pairing';
import { ensureUser } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Looks up a pairing code shown by an engine, so the user can check it before approving. */
export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  const code = PairCode.parse(new URL(request.url).searchParams.get('code') ?? '');
  return describePairing(user.uid, code);
});

const Body = z.object({ code: PairCode, displayName: z.string().trim().max(60).default('') });

/** Approves the code: links that engine to the mailbox for its verified Gmail address. */
export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await ensureUser(user);
  const body = Body.parse(await readJson(request));
  return approvePairing(user.uid, body.code, body.displayName);
});
