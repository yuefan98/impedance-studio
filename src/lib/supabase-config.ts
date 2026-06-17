export const SUPABASE_RAW_DATA_BUCKET = "impedance-raw-data";
export const SUPABASE_ANALYSIS_ARTIFACTS_BUCKET = "impedance-analysis-artifacts";

export type SupabaseConfigStatus = {
  configured: boolean;
  url: string | null;
  publishableKeyConfigured: boolean;
  buckets: {
    rawData: string;
    analysisArtifacts: string;
  };
};

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null;

  return {
    configured: Boolean(url && publishableKey),
    url,
    publishableKeyConfigured: Boolean(publishableKey),
    buckets: {
      rawData: SUPABASE_RAW_DATA_BUCKET,
      analysisArtifacts: SUPABASE_ANALYSIS_ARTIFACTS_BUCKET,
    },
  };
}
