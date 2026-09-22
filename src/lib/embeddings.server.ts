import path from "node:path";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// multilingual-e5-small: only local candidate (of 4 tested) that reliably ranked a
// real "same product, different wording" pair above a real "different product" pair
// on this app's actual French food-service invoice text — the two popular general
// multilingual paraphrase models tested (MiniLM-L12, mpnet-base) both failed that
// test outright. 384-dim output (vs. OpenAI's 1536 this replaces) — see the
// catalog_products.embedding migration for why that's a one-way local-only change.
const MODEL_ID = "Xenova/multilingual-e5-small";
// E5 models are trained with this exact prefix convention; dropping it measurably
// hurts ranking quality — must be applied identically here and in matching.server.ts's
// query-side embedding call, or the two sides land in different embedding spaces.
const QUERY_PREFIX = "query: ";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      cache_dir: path.join(process.cwd(), ".cache", "transformers"),
    });
  }
  return extractorPromise;
}

/**
 * Local replacement for the previous cloud embedding-API call — runs entirely
 * in-process (ONNX Runtime via @huggingface/transformers), no network call, no
 * API key. Batches to keep peak memory bounded on large catalog syncs.
 *
 * `batchSize` defaults to 32 for throughput on bulk catalog syncs, but callers whose
 * ranking depends on getting the *same* embedding for the *same* text regardless of what
 * else is being embedded alongside it (i.e. matching.server.ts, scoring one invoice's
 * lines against each other) MUST pass 1. Confirmed on real data: this model's dynamic
 * int8 quantization (`dtype: "q8"`) computes its quantization scale per batch, so the
 * identical string embedded alongside different texts can land in a measurably different
 * vector (cosine ~0.997, not 1.0) — enough to flip which catalog products rank in the
 * top-8 nearest neighbors. This is a known ONNX Runtime dynamic-quantization behavior,
 * not a padding/attention-mask bug — batch size 1 sidesteps it by construction.
 */
export async function embedTexts(texts: string[], batchSize = 32): Promise<number[][]> {
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts
      .slice(i, i + batchSize)
      .map((t) => QUERY_PREFIX + (t.slice(0, 2000) || " "));
    const result = await extractor(batch, { pooling: "mean", normalize: true });
    const dims = result.dims;
    const flat = Array.from(result.data as Float32Array | number[]);
    const dim = dims[dims.length - 1]!;
    for (let row = 0; row < batch.length; row += 1) {
      out.push(flat.slice(row * dim, (row + 1) * dim));
    }
  }
  return out;
}
