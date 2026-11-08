import { requireUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { revokeMcpToken } from '@/lib/mcp-tokens';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ tokenId: string }> };

export const DELETE = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser(request);
  await revokeMcpToken(user.uid, (await params).tokenId);
  return { revoked: true };
});
