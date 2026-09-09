// error-sink.ts — a RE-EXPORT. The one home is services/_shared/src/error-sink.ts.
// Its header holds the hand-rolled-envelope reasoning, the privacy invariants,
// the fail-open rule and why `SinkContext.appId` is optional rather than
// defaulted. [pipeline 11]E-8, [ADR 067] decision 2.
export * from '../../../_shared/src/error-sink';
