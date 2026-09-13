import { fetchLatestGobMxBulletin, type GobMxBulletin } from "./gobmx";
import { fetchLatestContingencyBulletin, type ContingencyBulletin } from "./source";

export type CombinedContingencyResult = {
  bulletin: ContingencyBulletin | null;
  camE: ContingencyBulletin | null;
  gobMx: GobMxBulletin | null;
  gobMxError: string | null;
};

export async function fetchCombinedContingencyBulletin(sourceFetch: typeof fetch = fetch): Promise<CombinedContingencyResult> {
  const [camEResult, gobMxResult] = await Promise.allSettled([
    fetchLatestContingencyBulletin(sourceFetch),
    fetchLatestGobMxBulletin(sourceFetch),
  ]);
  const camE = camEResult.status === "fulfilled" ? camEResult.value : null;
  const gobMx = gobMxResult.status === "fulfilled" ? gobMxResult.value : null;
  const gobMxError = gobMxResult.status === "rejected"
    ? describeSourceFailure(gobMxResult.reason)
    : null;

  if (!camE && !gobMx) {
    const camEDetail = camEResult.status === "rejected" ? describeSourceFailure(camEResult.reason) : "no_bulletin";
    const gobMxDetail = gobMxResult.status === "rejected" ? describeSourceFailure(gobMxResult.reason) : "no_bulletin";
    throw new Error(`Official contingency sources could not be consulted (CAMe: ${camEDetail}; gob.mx: ${gobMxDetail})`);
  }

  const bulletin = camE
    ? { ...camE, affectedDate: camE.affectedDate ?? gobMx?.affectedDate ?? null }
    : gobMx
      ? { ...gobMx, restriction: null }
      : null;
  return { bulletin, camE, gobMx, gobMxError };
}

function describeSourceFailure(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return String(reason ?? "source_failure");
}
