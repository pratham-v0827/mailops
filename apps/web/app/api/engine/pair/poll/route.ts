import { PairPoll } from '@mailops/schema';
import { handle, readJson } from '@/lib/http';
import { pollPairing } from '@/lib/pairing';

export const dynamic = 'force-dynamic';

/** The engine waits for the user to approve its code; returns the connector token once. */
export const POST = handle(async (request: Request) => {
  const body = PairPoll.parse(await readJson(request));
  return pollPairing(body.deviceCode);
});
