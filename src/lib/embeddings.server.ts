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
 * Local replacement for the Lovable AI Gateway embedding call — runs entirely
 * in-process (ONNX Runtime via @huggingface/transformers), no network call, no
 * API key. Batches to keep peak memory bounded on large catalog syncs.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const out: number[][] = [];
  const batchSize = 32;
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
