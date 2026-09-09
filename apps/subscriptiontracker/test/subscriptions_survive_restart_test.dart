import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// 🔴 THE DEFECT, AND THE ONLY PROOF THAT IT IS CLOSED.
///
/// A `flutter test` takes no `--dart-define`s, so `AppConfig.isApiConfigured` is
/// false here — which is not a testing convenience, it is the SHIPPED default:
/// every build with no `API_BASE_URL` resolves the same branch. On that branch
/// `SeedApiClient` held the user's subscriptions in plain fields on a
/// non-auto-dispose provider, so an added subscription survived every navigation
/// and died with the process. Nothing logged it. Nothing could: there was simply
/// nowhere for the row to go.
///
/// Every test below builds a container, uses the app's OWN provider chain
/// (`subscriptionRepositoryProvider` → `apiClientProvider` → the persisted
/// client → the key-value store), disposes it, and builds a SECOND container
/// over the same bytes. Two containers over one store is a restart — the same
/// shape `settings_wiring_test.dart`'s "the chosen currency SURVIVES a restart"
/// uses, and for the same reason: it is the only thing a widget test can do that
/// a relaunch also does.
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

/// A launch of the app against [kv] — the platform store the OS would hand it.
///
/// Only the store is overridden. The client, the repository and the branch that
/// chooses between them are the app's own, so a wiring mistake in
/// `apiClientProvider` fails these tests rather than being papered over by a
/// fake repository.
ProviderContainer _launch(_MemStore kv) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((Ref ref) async => kv),
  ],
);

Subscription _draft(String name) => Subscription(
  id: '',
  name: name,
  category: 'AI tools',
  price: const Money(2000, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2026, 10, 1),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('🔴 A SUBSCRIPTION THE USER ADDS SURVIVES A RESTART', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final Subscription created = await first
        .read(subscriptionRepositoryProvider)
        .add(_draft('Claude Pro'));
    expect(created.name, 'Claude Pro');
    first.dispose();

    // The relaunch. Nothing is carried over but the bytes in the store.
    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final List<Subscription> subs = await reborn
        .read(subscriptionRepositoryProvider)
        .fetchAll();

    expect(
      subs.map((Subscription s) => s.name),
      contains('Claude Pro'),
      reason:
          'this is the whole defect. Before the fix the second container read a '
          'freshly constructed SeedApiClient and the row was simply gone, with '
          'no error and nothing in any log.',
    );
    expect(
      subs.where((Subscription s) => s.name == 'Claude Pro'),
      hasLength(1),
      reason: 'a restart must not duplicate the row it restored',
    );
  });

  test('a CANCELLED subscription stays cancelled across a restart', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final SubscriptionRepository repo = first.read(
      subscriptionRepositoryProvider,
    );
    final List<Subscription> before = await repo.fetchAll();
    final Subscription victim = before.first;
    await repo.cancel(victim.id);
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final List<Subscription> after = await reborn
        .read(subscriptionRepositoryProvider)
        .fetchAll();

    expect(after.map((Subscription s) => s.id), isNot(contains(victim.id)));
    expect(after, hasLength(before.length - 1));
  });

  test('an EDIT survives a restart', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final SubscriptionRepository repo = first.read(
      subscriptionRepositoryProvider,
    );
    final String id = (await repo.fetchAll()).first.id;
    await repo.update(id, <String, dynamic>{'name': 'Renamed', 'price': 1.23});
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final Subscription reread =
        (await reborn.read(subscriptionRepositoryProvider).fetchAll())
            .firstWhere((Subscription s) => s.id == id);
    expect(reread.name, 'Renamed');
    // ⚠️ THE PATCH IS STILL A BARE `num` AND THE ROW KEEPS ITS OWN CURRENCY.
    // `changes` comes off the wire, where a price is a decimal with no
    // currency beside it, so `copyWith` reads 1.23 as 123 minor units of the
    // unit this row was already in — a patch that changes the NUMBER has not
    // changed the currency.
    expect(reread.price, const Money(123, 'USD'));
  });

  test('the BUDGET survives a restart', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    await first
        .read(subscriptionRepositoryProvider)
        .saveBudget(
          const BudgetInfo(
            monthlyBudget: Money(25000, 'USD'),
            categories: <BudgetCap>[BudgetCap('AI tools', Money(6000, 'USD'))],
          ),
        );
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final BudgetInfo budget = await reborn
        .read(subscriptionRepositoryProvider)
        .budget();
    expect(budget.monthlyBudget, const Money(25000, 'USD'));
    expect(budget.categories.single.name, 'AI tools');
    expect(budget.categories.single.cap, const Money(6000, 'USD'));
  });

  test('🔴 AN EMPTIED LIST STAYS EMPTY — the seed is not re-planted', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final SubscriptionRepository repo = first.read(
      subscriptionRepositoryProvider,
    );
    for (final Subscription s in await repo.fetchAll()) {
      await repo.cancel(s.id);
    }
    expect(await repo.fetchAll(), isEmpty);
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    expect(
      await reborn.read(subscriptionRepositoryProvider).fetchAll(),
      isEmpty,
      reason:
          'absent is not empty. If the store answered "nothing here" for a '
          'deliberately cleared list, twelve demo rows would be planted back on '
          'top of the user on every launch, for ever.',
    );
  });

  test('a FRESH device still gets the demo set, and keeps it', () async {
    final _MemStore kv = _MemStore();
    expect(kv.data, isEmpty);

    final ProviderContainer first = _launch(kv);
    addTearDown(first.dispose);
    final List<Subscription> subs = await first
        .read(subscriptionRepositoryProvider)
        .fetchAll();

    expect(
      subs,
      isNotEmpty,
      reason:
          'test/support/width_harness.dart leans on this: left alone, the '
          'unconfigured chain renders a POPULATED list, because an empty state '
          'has no rows to stretch and a width test that measures one is an '
          'assertion that cannot fail.',
    );
    // And the seed is now the device's own — it was written down, not just
    // constructed, so the ids the user sees today are the ids they see tomorrow.
    expect(kv.data.keys, contains(kLocalSubscriptionsKey));
    expect(kv.data.keys, contains(kLocalBudgetKey));
  });

  test('a corrupt store falls back to the seed instead of breaking', () async {
    final _MemStore kv = _MemStore();
    kv.data[kLocalSubscriptionsKey] = 'not json {{{';
    kv.data[kLocalBudgetKey] = 'not json {{{';

    final ProviderContainer c = _launch(kv);
    addTearDown(c.dispose);
    expect(await c.read(subscriptionRepositoryProvider).fetchAll(), isNotEmpty);
    // ⚠️ `greaterThan(0)` NO LONGER TYPE-CHECKS AT RUNTIME and the analyzer
    // cannot say so: `expect`'s matcher argument is `dynamic`, so an int
    // against a [Money] compiles and then throws inside `_OrderingMatcher`.
    // The claim is "the seed budget is a real figure", so it is read off the
    // minor units — the one axis that is comparable without naming a currency.
    expect(
      (await c.read(subscriptionRepositoryProvider).budget())
          .monthlyBudget
          .minorUnits,
      greaterThan(0),
    );
  });

  test('a store that is not there costs persistence and nothing else', () async {
    // No `keyValueStoreProvider` override at all: under `flutter test` there is
    // no `shared_preferences` plugin, so the real provider's future FAILS. The
    // app must still run — this is the same degradation a browser with storage
    // blocked, or a device with no writable profile, produces in the field.
    final ProviderContainer c = ProviderContainer();
    addTearDown(c.dispose);
    final List<Subscription> subs = await c
        .read(subscriptionRepositoryProvider)
        .fetchAll();
    expect(subs, isNotEmpty);
    final Subscription created = await c
        .read(subscriptionRepositoryProvider)
        .add(_draft('Claude Pro'));
    expect(created.name, 'Claude Pro');
  });
}
