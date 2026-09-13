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
    ? gobMxResult.reason instanceof Error ? gobMxResult.reason.name : "source_failure"
    : null;

  if (!camE && !gobMx) {
    throw new Error("Official contingency sources could not be consulted");
  }

  const bulletin = camE
    ? { ...camE, affectedDate: camE.affectedDate ?? gobMx?.affectedDate ?? null }
    : gobMx
      ? { ...gobMx, restriction: null }
      : null;
  return { bulletin, camE, gobMx, gobMxError };
}
