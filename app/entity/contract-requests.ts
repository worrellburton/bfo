/**
 * The signature requests behind an entity's contracts, for the Contracts tab
 * and the contract page.
 */

import { signApi, type SignatureRequest } from "../sign/api";

/** Every signature request the person can see, whichever shape the list comes back in. */
export async function listRequests(): Promise<SignatureRequest[]> {
  const res: unknown = await signApi.list();
  if (Array.isArray(res)) return res as SignatureRequest[];
  return ((res as { requests?: SignatureRequest[] } | null)?.requests ?? []) as SignatureRequest[];
}
