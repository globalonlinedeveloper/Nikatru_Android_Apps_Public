// ─────────────────────────────────────────────────────────────────────────────
// WHICH FEATURE SET A VERIFIED RECEIPT BUYS — resolved SERVER-SIDE, from a
// register, and never from the request.
//
// 🔴 THIS FILE IS HALF OF INVARIANT G7. "No entitlement without a verified
// receipt" is not only about the receipt being real; it is also about the GRANT
// being the one the receipt is evidence for. A route that took the feature set
// from the request body would verify a 1-app purchase and write a grant for
// everything, and every signature check upstream would still be green. So the
// mapping runs one way only: the STORE says which product id was bought, and
// this module answers which pinned `(feature_set_name, feature_set_version)` that
// product id sells. tooling/ci/assert-bundle-provenance.mjs greps for the
// opposite shape and goes RED on it.
//
// [ADR 057] §4 — the version is PINNED AT INSERT. Editing catalog/bundles.json
// changes what a FUTURE grant is sold under and can never change what an existing
// grant already owns.
//
// ⚠️ THE MAP IS EMPTY TODAY, AND EMPTY IS THE HONEST ANSWER. catalog/bundles.json
// declares the DRAFT bundle and carries no store product ids, because no store
// SKU has been minted — the bundle is not purchasable (one live product; the
// derivation needs two) and no store listing may mention it (invariant G6). So
// every rail's verified receipt currently resolves to NOTHING and the route
// answers 422. Inventing a product id here to make a path testable would put a
// handle in the tree that resolves to no real SKU, which is the same defect
// catalog/bundles.json's own `priceIds` comment refuses for prices.
// ─────────────────────────────────────────────────────────────────────────────
import bundlesJson from '../../../../../catalog/bundles.json';

/** The pinned identity a grant records, plus what it unlocks. */
export interface FeatureSetRef {
  readonly name: string;
  readonly version: number;
  readonly products: readonly string[];
}

interface BundleRow {
  featureSet?: unknown;
  version?: unknown;
  members?: unknown;
  /**
   * Optional and ABSENT TODAY. When a store SKU is minted it lands here as
   * `{ "<store>": ["<product id>", …] }`, keyed by the receipt registry's `store`
   * — which is also `bundle_grants.provider`, so one string names the rail in the
   * register, in the URL and in the row.
   */
  storeProductIds?: unknown;
}

/** `(store, productId)` → the feature set that product sells. */
export type ProductMap = ReadonlyMap<string, FeatureSetRef>;

const key = (store: string, productId: string) => `${store}\u0000${productId}`;

function readRegister(rows: readonly BundleRow[]): ProductMap {
  const out = new Map<string, FeatureSetRef>();
  for (const row of rows) {
    const name = typeof row.featureSet === 'string' ? row.featureSet : '';
    const version = typeof row.version === 'number' ? row.version : NaN;
    if (name === '' || !Number.isInteger(version)) continue;
    const products = (Array.isArray(row.members) ? row.members : [])
      .map((m) => (m !== null && typeof m === 'object' ? (m as { slug?: unknown }).slug : null))
      .filter((s): s is string => typeof s === 'string' && s !== '');
    const byStore = row.storeProductIds;
    if (byStore === null || typeof byStore !== 'object') continue;
    for (const [store, ids] of Object.entries(byStore as Record<string, unknown>)) {
      // `_why` keys are documentation and are not stores. Skipping them by shape
      // (a store's value is an array of ids) rather than by name means a second
      // documentation key never becomes a rail.
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id === 'string' && id !== '') {
          out.set(key(store, id), { name, version, products });
        }
      }
    }
  }
  return out;
}

/** The register as it stands in the tree. Empty today; see the header. */
export const REGISTER_PRODUCT_MAP: ProductMap = readRegister(
  bundlesJson as unknown as readonly BundleRow[],
);

/**
 * Resolve a verified store product id to the feature set it sells.
 *
 * `override` exists for ONE reason and it is a test seam, not a back door: the
 * register is legitimately empty, so without it the grant path could only be
 * exercised by inventing a SKU in a committed register. It is a parameter of a
 * pure function — nothing on the request path can supply it, which is the
 * property that keeps this module on the right side of G7.
 */
export function featureSetForProduct(
  store: string,
  productId: string,
  override: ProductMap = REGISTER_PRODUCT_MAP,
): FeatureSetRef | null {
  return override.get(key(store, productId)) ?? null;
}
