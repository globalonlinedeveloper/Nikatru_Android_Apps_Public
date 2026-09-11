// 🔴 THE PROOF THAT PERSISTENCE IS ON THE PRODUCTION PATH.
//
// Every real build has the API configured, and until this change that branch
// used a bare `DioApiClient` with no local copy: the list was fetched on every
// launch and kept nowhere. `CachedApiClient` mirrors what the server last said
// into the device store and serves it — only when the server cannot be asked.
//
// The shape of every "survives" case is two CLIENTS over one store: the first
// sees the network, the second is built fresh (a restart) with the network
// dead. That is the only thing a unit test can do that a relaunch also does.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/cached_api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

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

class _BrokenStore implements core.KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => throw StateError('disk full');
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> remove(String key) async => throw StateError('disk full');
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('disk full');
}

/// The Worker, as far as this client can tell: a list, a budget, and a switch
/// that turns every call into the failure a dead network produces.
class _FakeNetwork implements ApiClient {
  _FakeNetwork(this.subs, this.budget);

  List<Subscription> subs;
  BudgetInfo budget;

  /// Null = reachable. Otherwise every call throws this.
  ApiException? failure;
  int calls = 0;

  void _gate() {
    calls += 1;
    final ApiException? f = failure;
    if (f != null) throw f;
  }

  @override
  Future<List<Subscription>> getSubscriptions() async {
    _gate();
    return List<Subscription>.unmodifiable(subs);
  }

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    _gate();
    final Subscription created = Subscription(
      id: 'srv-${subs.length + 1}',
      name: draft.name,
      category: draft.category,
      price: draft.price,
      cycle: draft.cycle,
      nextRenewal: draft.nextRenewal,
    );
    subs = <Subscription>[...subs, created];
    return created;
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    _gate();
    return subs.firstWhere((Subscription s) => s.id == id);
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    _gate();
    final int i = subs.indexWhere((Subscription s) => s.id == id);
    final Subscription updated = subs[i].copyWith(
      name: changes['name'] as String?,
    );
    subs = <Subscription>[...subs]..[i] = updated;
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    _gate();
    subs = subs.where((Subscription s) => s.id != id).toList();
  }

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    _gate();
    return const <PaymentRecord>[];
  }

  @override
  Future<BudgetInfo> getBudget() async {
    _gate();
    return budget;
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo b) async {
    _gate();
    return budget = b;
  }

  @override
  Future<core.Entitlements> getEntitlements() async {
    _gate();
    return core.Entitlements.none;
  }
}

Subscription _sub(String id, String name) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: const Money(1549, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 7, 22),
);

const BudgetInfo _budget = BudgetInfo(
  monthlyBudget: Money(500000, 'INR'),
  categories: <BudgetCap>[],
);

final ApiException _offline = ApiException(0, 'Network error');

void main() {
  late _MemStore kv;
  LocalSubscriptionStore store() =>
      LocalSubscriptionStore(Future<core.KeyValueStore>.value(kv));

  setUp(() => kv = _MemStore());

  group('🔴 KILL THE NETWORK — the list survives a restart', () {
    test(
      'a list the server returned once is served when the server is gone',
      () async {
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'Netflix'),
          _sub('b', 'Spotify'),
        ], _budget);
        // Launch 1: online.
        final CachedApiClient first = CachedApiClient(net, store());
        expect((await first.getSubscriptions()).length, 2);
        expect(first.lastReadWasFromCache, isFalse);

        // Launch 2: a NEW client over the SAME bytes, network dead.
        net.failure = _offline;
        final CachedApiClient second = CachedApiClient(net, store());
        final List<Subscription> offline = await second.getSubscriptions();
        expect(offline.map((Subscription s) => s.name), <String>[
          'Netflix',
          'Spotify',
        ]);
        expect(second.lastReadWasFromCache, isTrue);
      },
    );

    test('the budget survives the same way', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[], _budget);
      await CachedApiClient(net, store()).getBudget();
      net.failure = _offline;
      final BudgetInfo b = await CachedApiClient(net, store()).getBudget();
      expect(b.monthlyBudget, const Money(500000, 'INR'));
    });

    test('a row ADDED online is in the offline copy', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      final CachedApiClient first = CachedApiClient(net, store());
      await first.getSubscriptions();
      await first.createSubscription(_sub('', 'Claude Pro'));
      net.failure = _offline;
      final List<Subscription> offline = await CachedApiClient(
        net,
        store(),
      ).getSubscriptions();
      expect(offline.map((Subscription s) => s.name), contains('Claude Pro'));
    });

    test('a row DELETED online is gone from the offline copy', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
        _sub('b', 'B'),
      ], _budget);
      final CachedApiClient first = CachedApiClient(net, store());
      await first.getSubscriptions();
      await first.deleteSubscription('a');
      net.failure = _offline;
      final List<Subscription> offline = await CachedApiClient(
        net,
        store(),
      ).getSubscriptions();
      expect(offline.map((Subscription s) => s.id), <String>['b']);
    });

    test('an EDIT made online is in the offline copy', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      final CachedApiClient first = CachedApiClient(net, store());
      await first.getSubscriptions();
      await first.updateSubscription('a', <String, dynamic>{'name': 'A+'});
      net.failure = _offline;
      final List<Subscription> offline = await CachedApiClient(
        net,
        store(),
      ).getSubscriptions();
      expect(offline.single.name, 'A+');
    });

    test('a single row is answered from the copy too', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      await CachedApiClient(net, store()).getSubscriptions();
      net.failure = _offline;
      final Subscription s = await CachedApiClient(
        net,
        store(),
      ).getSubscription('a');
      expect(s.name, 'A');
    });

    test('a 5xx is "the server is gone" as much as no network is', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      await CachedApiClient(net, store()).getSubscriptions();
      net.failure = ApiException(503, 'Service Unavailable');
      expect(
        await CachedApiClient(net, store()).getSubscriptions(),
        hasLength(1),
      );
    });
  });

  group('the cache never invents an answer', () {
    test('nothing cached + no network ⇒ the failure travels', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[], _budget)
        ..failure = _offline;
      await expectLater(
        CachedApiClient(net, store()).getSubscriptions(),
        throwsA(isA<ApiException>()),
      );
    });

    test(
      '🔴 a 401 is NOT offline — another account\'s copy is never served',
      () async {
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        await CachedApiClient(net, store()).getSubscriptions();
        net.failure = ApiException(401, 'Unauthorized');
        await expectLater(
          CachedApiClient(net, store()).getSubscriptions(),
          throwsA(
            isA<ApiException>().having(
              (ApiException e) => e.statusCode,
              'status',
              401,
            ),
          ),
        );
      },
    );

    test('a 404 travels unchanged', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      await CachedApiClient(net, store()).getSubscriptions();
      net.failure = ApiException(404, 'Not Found');
      await expectLater(
        CachedApiClient(net, store()).getSubscription('a'),
        throwsA(isA<ApiException>()),
      );
    });

    test(
      'writes go to the server FIRST and an offline write fails honestly',
      () async {
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        final CachedApiClient c = CachedApiClient(net, store());
        await c.getSubscriptions();
        net.failure = _offline;
        await expectLater(
          c.createSubscription(_sub('', 'Nope')),
          throwsA(isA<ApiException>()),
        );
        // And the copy was not touched: it still says what the server last said.
        expect(await store().readSubscriptions(), hasLength(1));
      },
    );

    test('entitlements are NEVER served from this cache', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[], _budget);
      await CachedApiClient(net, store()).getEntitlements();
      net.failure = _offline;
      await expectLater(
        CachedApiClient(net, store()).getEntitlements(),
        throwsA(isA<ApiException>()),
      );
      expect(kv.data.keys, isNot(contains(contains('entitle'))));
    });
  });

  group('a cache write failure is never silent', () {
    test(
      'the operation succeeds (the server has it) AND the failure is reported',
      () async {
        final List<Object> reported = <Object>[];
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        final CachedApiClient c = CachedApiClient(
          net,
          LocalSubscriptionStore(
            Future<core.KeyValueStore>.value(_BrokenStore()),
          ),
          onCacheWriteFailed: reported.add,
        );
        expect(await c.getSubscriptions(), hasLength(1));
        expect(c.cacheWriteFailures, 1);
        expect(c.lastCacheWriteError, isA<LocalStoreWriteFailure>());
        expect(reported, hasLength(1));
        expect('${reported.single}', contains('disk full'));
      },
    );
  });
}
