// ─────────────────────────────────────────────────────────────────────────────
// bundle.d.ts — the TypeScript view of bundle.js. Hand-written, never generated,
// and never compiled: a declaration file emits nothing, so it does not make
// anything that imports it a "built" artefact. Same arrangement as contract.d.ts
// beside it — one file of runtime, one file of types, zero build steps.
// ─────────────────────────────────────────────────────────────────────────────

export interface BundleSource {
  readonly source: string;
  /**
   * Whether a grant from this source is only legitimate with a VERIFIED receipt
   * behind it. The machine-readable half of "no entitlement without a verified
   * receipt" — dropping or flipping this field is the bug, and it looks correct
   * in a diff.
   */
  readonly requiresReceipt: boolean;
}

export const BUNDLE_SOURCES: readonly BundleSource[];

export function isBundleSource(v: unknown): boolean;

/** Fail-closed: an UNKNOWN source returns `true`. */
export function requiresReceipt(source: string): boolean;

/**
 * A product is an app, an extension or a script. The bundle spans all three,
 * which is what keeps a new category a DATA change rather than a schema change.
 */
export type ProductKind = 'app' | 'extension' | 'script';

export const PRODUCT_KINDS: readonly ProductKind[];

export function isProductKind(v: unknown): v is ProductKind;

export interface ProductRegister {
  readonly kind: ProductKind;
  /** `null` = the category is DECLARED and has no register yet. */
  readonly register: string | null;
}

export const PRODUCT_REGISTERS: readonly ProductRegister[];

/** The two values assert-catalog-contract.mjs permits. */
export type ProductStatus = 'live' | 'preview';

export const PRODUCT_STATUSES: readonly ProductStatus[];

/** Two. A "bundle" of one live product is a second SKU for one thing. */
export const MIN_LIVE_PRODUCTS_FOR_BUNDLE: number;

export const BUNDLE_TABLE: {
  readonly bundleSources: readonly BundleSource[];
  readonly productKinds: readonly ProductKind[];
  readonly productRegisters: readonly ProductRegister[];
  readonly productStatuses: readonly ProductStatus[];
  readonly minLiveProductsForBundle: number;
};
