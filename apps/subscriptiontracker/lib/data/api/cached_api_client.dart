import 'package:flutter/foundation.dart' show debugPrint;
import 'package:nikatru_core/nikatru_core.dart' show Entitlements;

import '../local/subscription_store.dart';
import '../models/budget_info.dart';
import '../models/payment_record.dart';
import '../models/subscription.dart';
import 'api_client.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE PRODUCTION PATH KEPT NOTHING ON THE DEVICE.
//
// 🔴 WHAT WAS BROKEN. `PersistedApiClient` (#590/#595) wrapped ONLY the seed
// client, and only when `!AppConfig.isApiConfigured`. Every real build carries
// the API (`catalog/apps.json` sets `api`), so the shipped app used a bare
// `DioApiClient`: the list was fetched on every launch and nothing was kept.
// Offline, or with the Worker down, the home screen had NOTHING to show a user
// who had been looking at their own subscriptions an hour earlier. The
// persistence work landed, and it landed on the branch that never ships.
//
// ⚠️ THIS IS A READ-THROUGH CACHE, NOT A WRITE QUEUE, and the line is drawn on
// purpose. The Worker stays the system of record: every write goes to it FIRST
// and only a write it accepted is mirrored here. Nothing is queued for replay,
// so there is no conflict to resolve and no ordering to get wrong — an offline
// add fails honestly ("could not save"), which the add sheet already renders.
// The cache answers exactly one question: "what did the server last tell this
// device?", and it answers it only when the server cannot be asked.
//
// 🔴 WHEN THE CACHE MAY ANSWER. Only for a TRANSPORT failure (status 0: no
// network, DNS, timeout) or a SERVER failure (5xx). A 401 is not "offline" —
// it is "this session is not accepted" — and serving a cached list there would
// show one account's subscriptions to whoever signs in next on the same device.
// Every other 4xx is a real answer about the request and travels unchanged.
// The same account boundary is why `userStateDrops` clears this store on
// sign-out when the API is configured.
//
// ⚠️ A CACHE WRITE FAILURE NEVER FAILS THE OPERATION — the server has the
// truth — BUT IT IS NEVER SILENT EITHER: it is counted, kept, and reported
// through [onCacheWriteFailed], so "the list did not survive restart" has a
// cause somebody can read rather than a shrug.
//
// ⚠️ ENTITLEMENTS ARE DELIBERATELY NOT CACHED HERE. The durable entitlement
// path is `EntitlementCache` over the SECURE store with its own staleness
// ceiling; an `isPro` in ordinary key-value storage is an unlock anyone with a
// text editor could grant themselves.
// ═════════════════════════════════════════════════════════════════════════════

/// [ApiClient] over a network client, with the device's key-value store as a
/// read-through cache of what the server last said.
class CachedApiClient implements ApiClient {
  CachedApiClient(
    this._network,
    this._store, {
    void Function(Object error)? onCacheWriteFailed,
  }) : _onCacheWriteFailed = onCacheWriteFailed ?? _reportCacheWriteFailure;

  final ApiClient _network;
  final LocalSubscriptionStore _store;
  final void Function(Object error) _onCacheWriteFailed;

  static void _reportCacheWriteFailure(Object e) =>
      debugPrint('🔴 [subscriptions] cache write failed: $e');

  /// Whether the most recent [getSubscriptions] or [getBudget] was answered by
  /// the cache because the server could not be reached. Observable so a
  /// surface can say "showing your last synced copy" rather than nothing.
  bool get lastReadWasFromCache => _lastReadWasFromCache;
  bool _lastReadWasFromCache = false;

  /// How many mirror writes have failed on this client. Zero on a healthy
  /// device; anything else is the cause of "it did not survive restart".
  int get cacheWriteFailures => _cacheWriteFailures;
  int _cacheWriteFailures = 0;

  /// The most recent mirror-write failure, kept for the UI and for tests.
  Object? get lastCacheWriteError => _lastCacheWriteError;
  Object? _lastCacheWriteError;

  /// Whether [e] is a failure the cache is allowed to stand in for.
  static bool servesFromCacheFor(ApiException e) =>
      e.statusCode == 0 || e.statusCode >= 500;

  Future<void> _mirrorSubscriptions(List<Subscription> subs) async {
    try {
      await _store.writeSubscriptions(subs);
    } on LocalStoreWriteFailure catch (e) {
      _recordCacheWriteFailure(e);
    }
  }

  Future<void> _mirrorBudget(BudgetInfo budget) async {
    try {
      await _store.writeBudget(budget);
    } on LocalStoreWriteFailure catch (e) {
      _recordCacheWriteFailure(e);
    }
  }

  void _recordCacheWriteFailure(Object e) {
    _cacheWriteFailures += 1;
    _lastCacheWriteError = e;
    _onCacheWriteFailed(e);
  }

  /// Apply [change] to the cached list, if there is one, and write it back.
  /// A device that has never cached a list has nothing to keep in step.
  Future<void> _amendCachedList(
    List<Subscription> Function(List<Subscription> cached) change,
  ) async {
    final List<Subscription>? cached = await _store.readSubscriptions();
    if (cached == null) return;
    await _mirrorSubscriptions(change(cached));
  }

  @override
  Future<List<Subscription>> getSubscriptions() async {
    try {
      final List<Subscription> fresh = await _network.getSubscriptions();
      _lastReadWasFromCache = false;
      await _mirrorSubscriptions(fresh);
      return fresh;
    } on ApiException catch (e) {
      if (!servesFromCacheFor(e)) rethrow;
      final List<Subscription>? cached = await _store.readSubscriptions();
      // Nothing cached is nothing to show: the failure travels, and the
      // screens render their failed state with a retry.
      if (cached == null) rethrow;
      _lastReadWasFromCache = true;
      return cached;
    }
  }

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    final Subscription created = await _network.createSubscription(draft);
    await _amendCachedList(
      (List<Subscription> cached) => <Subscription>[...cached, created],
    );
    return created;
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    try {
      return await _network.getSubscription(id);
    } on ApiException catch (e) {
      if (!servesFromCacheFor(e)) rethrow;
      final List<Subscription>? cached = await _store.readSubscriptions();
      final Subscription? hit = cached
          ?.where((Subscription s) => s.id == id)
          .firstOrNull;
      if (hit == null) rethrow;
      return hit;
    }
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    final Subscription updated = await _network.updateSubscription(id, changes);
    await _amendCachedList(
      (List<Subscription> cached) =>
          cached.map((Subscription s) => s.id == id ? updated : s).toList(),
    );
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    await _network.deleteSubscription(id);
    await _amendCachedList(
      (List<Subscription> cached) =>
          cached.where((Subscription s) => s.id != id).toList(),
    );
  }

  /// Not cached: a payment history is a detail-screen read, and a stale one
  /// is worse than a failed one that offers a retry.
  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) =>
      _network.getPaymentHistory(id);

  @override
  Future<BudgetInfo> getBudget() async {
    try {
      final BudgetInfo fresh = await _network.getBudget();
      _lastReadWasFromCache = false;
      await _mirrorBudget(fresh);
      return fresh;
    } on ApiException catch (e) {
      if (!servesFromCacheFor(e)) rethrow;
      final BudgetInfo? cached = await _store.readBudget();
      if (cached == null) rethrow;
      _lastReadWasFromCache = true;
      return cached;
    }
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    final BudgetInfo saved = await _network.updateBudget(budget);
    await _mirrorBudget(saved);
    return saved;
  }

  /// Never cached here — see the header. The server grants; the secure
  /// `EntitlementCache` remembers.
  @override
  Future<Entitlements> getEntitlements() => _network.getEntitlements();
}
