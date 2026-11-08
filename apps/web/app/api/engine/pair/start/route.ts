import { PairStart } from '@mailops/schema';
import { verifyGoogleIdentity } from '@/lib/google-id';
import { handle, readJson } from '@/lib/http';
import { startPairing } from '@/lib/pairing';

export const dynamic = 'force-dynamic';

/** A new engine asks to be linked. Its Google identity token proves which Gmail account it runs in. */
export const POST = handle(async (request: Request) => {
  const body = PairStart.parse(await readJson(request));
  const email = await verifyGoogleIdentity(body.identityToken);
  return startPairing(email, body.engineVersion);
});
