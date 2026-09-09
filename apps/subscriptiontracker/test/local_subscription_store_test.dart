import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

/// The same in-memory [core.KeyValueStore] `settings_wiring_test.dart` uses, and
/// for the same reason: it is the only way to hold a store across a simulated
/// restart, which is the property under test.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A store where the platform channel is simply not there — a `flutter test`
/// host with no `shared_preferences` plugin, a browser with storage disabled, a
/// Linux session with no writable profile. The contract is that persistence is
/// lost and NOTHING ELSE is.
class _BrokenStore implements core.KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => throw StateError('no store');
  @override
  Future<String?> read(String key) async => throw StateError('no store');
  @override
  Future<void> remove(String key) async => throw StateError('no store');
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('no store');
}

Subscription _sub(
  String id, {
  String name = 'Netflix',
  Money price = const Money(1549, 'USD'),
}) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: price,
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2026, 7, 22),
  plan: 'Premium 4K',
  glyph: 'NFX',
  usedPct: 78,
  usageNote: 'Watched 14 hrs this month.',
);

void main() {
  group('LocalSubscriptionStore', () {
    test('nothing stored reads back as NULL, not as an empty list', () async {
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(_MemStore()),
      );
      expect(
        await store.readSubscriptions(),
        isNull,
        reason:
            'null is what licenses the demo seed. If a fresh device read back '
            '[] instead, the seed would never be planted; if a CLEARED device '
            'read back null, twelve demo rows would be planted on top of a '
            'user who deliberately deleted everything.',
      );
      expect(await store.readBudget(), isNull);
    });

    test('an EMPTY list survives a restart as empty', () async {
      final _MemStore kv = _MemStore();
      await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).writeSubscriptions(<Subscription>[]);

      // A second store over the same bytes — the restart.
      final List<Subscription>? reborn = await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).readSubscriptions();
      expect(reborn, isNotNull);
      expect(reborn, isEmpty);
    });

    test('subscriptions round-trip with their fields intact', () async {
      final _MemStore kv = _MemStore();
      final List<Subscription> written = <Subscription>[
        _sub('1'),
        _sub('2', name: 'Spotify', price: const Money(1199, 'USD')),
      ];
      await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).writeSubscriptions(written);

      final List<Subscription> read = (await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).readSubscriptions())!;
      expect(read.map((Subscription s) => s.id), <String>['1', '2']);
      expect(read[1].name, 'Spotify');
      // 🔴 THE AMOUNT ROUND-TRIPS AS AN EXACT INTEGER, CURRENCY AND ALL.
      // `toJson` writes `price_minor` + `currency` beside the legacy decimal
      // `price`, and `fromJson` prefers the integer pair — so what this store
      // reads back is the same Money that went in, not a re-derived double.
      expect(read[1].price, const Money(1199, 'USD'));
      expect(read[0].cycle, BillingCycle.monthly);
      expect(read[0].nextRenewal, DateTime(2026, 7, 22));
      expect(read[0].plan, 'Premium 4K');
      expect(read[0].glyph, 'NFX');
      expect(read[0].usedPct, 78);
    });

    test('the budget round-trips, categories and all', () async {
      final _MemStore kv = _MemStore();
      const BudgetInfo written = BudgetInfo(
        monthlyBudget: Money(12000, 'USD'),
        categories: <BudgetCap>[BudgetCap('Streaming', Money(4000, 'USD'))],
      );
      await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).writeBudget(written);

      final BudgetInfo read = (await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).readBudget())!;
      // ⚠️ THE BUDGET IS THE ONE FIGURE THE WIRE CARRIES NO CURRENCY FOR, so
      // `BudgetInfo.fromJson` reads it under the code the CALLER names and the
      // codec has none to name — see `BudgetInfo.inCurrency`, which is how the
      // budget screen relabels it with the user's own choice. The AMOUNT still
      // round-trips exactly: `monthly_budget` is a decimal that came from an
      // integer count of minor units, and it rounds back to that integer.
      expect(read.monthlyBudget, const Money(12000, 'USD'));
      expect(read.categories.single.name, 'Streaming');
      expect(read.categories.single.cap, const Money(4000, 'USD'));
    });

    test('the persisted keys carry the nikatru. family prefix', () async {
      final _MemStore kv = _MemStore();
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      );
      await store.writeSubscriptions(<Subscription>[_sub('1')]);
      await store.writeBudget(
        const BudgetInfo(
          monthlyBudget: Money(100, 'USD'),
          categories: <BudgetCap>[],
        ),
      );
      expect(kv.data.keys, <String>{'nikatru.subscriptions', 'nikatru.budget'});
      expect(kLocalSubscriptionsKey, 'nikatru.subscriptions');
      expect(kLocalBudgetKey, 'nikatru.budget');
    });

    test('a corrupt payload reads as NULL rather than throwing', () async {
      final _MemStore kv = _MemStore();
      kv.data[kLocalSubscriptionsKey] = 'not json {{{';
      kv.data[kLocalBudgetKey] = 'not json {{{';
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      );
      expect(await store.readSubscriptions(), isNull);
      expect(await store.readBudget(), isNull);
    });

    test('a JSON value of the wrong SHAPE reads as null', () async {
      final _MemStore kv = _MemStore();
      kv.data[kLocalSubscriptionsKey] = '{"not":"a list"}';
      kv.data[kLocalBudgetKey] = '["not","an object"]';
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      );
      expect(await store.readSubscriptions(), isNull);
      expect(await store.readBudget(), isNull);
    });

    test('ONE unreadable row costs that row and no other', () async {
      final _MemStore kv = _MemStore();
      kv.data[kLocalSubscriptionsKey] = jsonEncode(<Object?>[
        _sub('1').toJson(),
        <String, dynamic>{'id': '2', 'next_renewal': 'not-a-date'},
        _sub('3', name: 'Spotify').toJson(),
      ]);
      final List<Subscription>? read = await LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      ).readSubscriptions();
      expect(
        read!.map((Subscription s) => s.id),
        <String>['1', '3'],
        reason:
            'rejecting the whole payload for one bad row would throw away every '
            'other subscription the user owns — data loss as the repair for a '
            'display problem',
      );
    });

    test('clear() forgets both keys', () async {
      final _MemStore kv = _MemStore();
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(kv),
      );
      await store.writeSubscriptions(<Subscription>[_sub('1')]);
      await store.writeBudget(
        const BudgetInfo(
          monthlyBudget: Money(100, 'USD'),
          categories: <BudgetCap>[],
        ),
      );
      await store.clear();
      expect(kv.data, isEmpty);
      expect(await store.readSubscriptions(), isNull);
    });

    test('a store that THROWS costs persistence and nothing else', () async {
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.value(_BrokenStore()),
      );
      await expectLater(
        store.writeSubscriptions(<Subscription>[_sub('1')]),
        completes,
      );
      await expectLater(store.clear(), completes);
      expect(await store.readSubscriptions(), isNull);
      expect(await store.readBudget(), isNull);
    });

    test('a store whose FUTURE fails is the same degradation', () async {
      final LocalSubscriptionStore store = LocalSubscriptionStore(
        Future<core.KeyValueStore>.error(StateError('no plugin')),
      );
      await expectLater(
        store.writeBudget(
          const BudgetInfo(
            monthlyBudget: Money(100, 'USD'),
            categories: <BudgetCap>[],
          ),
        ),
        completes,
      );
      expect(await store.readSubscriptions(), isNull);
    });

    test('the inMemory store persists nothing across a restart', () async {
      final LocalSubscriptionStore store = LocalSubscriptionStore.inMemory();
      await store.writeSubscriptions(<Subscription>[_sub('1')]);
      expect(await store.readSubscriptions(), hasLength(1));
      expect(
        await LocalSubscriptionStore.inMemory().readSubscriptions(),
        isNull,
        reason: 'a fresh in-memory store is a fresh device, by construction',
      );
    });
  });
}
