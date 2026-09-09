import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  group('InMemoryKeyValueStore', () {
    test('write then read round-trips, containsKey + remove behave', () async {
      final KeyValueStore kv = InMemoryKeyValueStore();
      expect(await kv.read('k'), isNull);
      expect(await kv.containsKey('k'), isFalse);

      await kv.write('k', 'v');
      expect(await kv.read('k'), 'v');
      expect(await kv.containsKey('k'), isTrue);

      await kv.write('k', 'v2'); // overwrite
      expect(await kv.read('k'), 'v2');

      await kv.remove('k');
      expect(await kv.read('k'), isNull);
      expect(await kv.containsKey('k'), isFalse);
      // remove of an absent key is a no-op.
      await kv.remove('k');
    });

    test('seed pre-populates the store', () async {
      final KeyValueStore kv =
          InMemoryKeyValueStore(<String, String>{'a': '1'});
      expect(await kv.read('a'), '1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE REGRESSION THIS SEAM EXISTS TO PREVENT.
  //
  // After the move to `nikatru.com/<app>` every app shares one browser origin,
  // and web storage is origin-scoped. `ONE backing map, two stores` below is
  // not a contrivance — it is a faithful model of that origin's `localStorage`.
  // Before namespacing, the second write into the same logical key overwrote
  // the first app's value and BOTH stores then read the same string back, with
  // no error anywhere. These tests fail if that ever becomes true again.
  // ───────────────────────────────────────────────────────────────────────────
  group('StorageNamespace', () {
    test('qualify prefixes with the app id and unqualify inverts it', () {
      final StorageNamespace ns = StorageNamespace('alpha_app');
      expect(ns.prefix, 'alpha_app.');
      expect(ns.qualify('theme_mode'), 'alpha_app.theme_mode');
      expect(ns.owns('alpha_app.theme_mode'), isTrue);
      expect(ns.owns('beta_app.theme_mode'), isFalse);
      expect(ns.unqualify('alpha_app.theme_mode'), 'theme_mode');
      expect(ns.unqualify('beta_app.theme_mode'), isNull);
    });

    test('rejects an app id that could make one namespace shadow another', () {
      // The id is the literal head of every stored key. An id carrying the
      // separator, or upper case, or a leading digit, is how a prefix stops
      // being a partition — so it is refused loudly rather than concatenated.
      for (final String bad in <String>[
        '',
        'Alpha',
        'alpha.app',
        'alpha-app',
        '1app',
        'alpha app',
        '_alpha',
      ]) {
        expect(
          () => StorageNamespace(bad),
          throwsArgumentError,
          reason: '"$bad" was accepted as a storage namespace',
        );
      }
    });

    test('two namespaces are equal only when their app ids are', () {
      expect(StorageNamespace('alpha_app'), StorageNamespace('alpha_app'));
      expect(
        StorageNamespace('alpha_app'),
        isNot(StorageNamespace('beta_app')),
      );
    });
  });

  group('NamespacedKeyValueStore over ONE shared backing store', () {
    // The shared origin, modelled: a single map, exactly as two apps on
    // nikatru.com/<app> share a single `localStorage`.
    late Map<String, String> origin;
    late KeyValueStore alpha;
    late KeyValueStore beta;

    setUp(() {
      origin = <String, String>{};
      // NOT InMemoryKeyValueStore: its constructor COPIES the seed, so the map
      // handed in would never see a write and the raw-key assertion below would
      // pass over an empty map — the "scan that reached nothing" shape.
      final KeyValueStore backing = _SharedOriginStore(origin);
      alpha = NamespacedKeyValueStore(inner: backing, appId: 'alpha_app');
      beta = NamespacedKeyValueStore(inner: backing, appId: 'beta_app');
    });

    test('the same logical key holds DIFFERENT values per app', () async {
      await alpha.write('theme_mode', 'dark');
      await beta.write('theme_mode', 'light');

      expect(await alpha.read('theme_mode'), 'dark');
      expect(await beta.read('theme_mode'), 'light');
    });

    test('one app cannot see a key written by the other', () async {
      await alpha.write('onboarding_done', 'true');

      expect(await beta.containsKey('onboarding_done'), isFalse);
      expect(await beta.read('onboarding_done'), isNull);
      expect(await alpha.containsKey('onboarding_done'), isTrue);
    });

    test('remove is scoped: it cannot delete the value of another app',
        () async {
      await alpha.write('install_id', 'a-1');
      await beta.write('install_id', 'b-1');

      await beta.remove('install_id');

      expect(await beta.read('install_id'), isNull);
      expect(
        await alpha.read('install_id'),
        'a-1',
        reason: 'a sign-out in one app wiped another app on the same origin',
      );
    });

    test('the RAW stored keys are distinct and carry the app id', () async {
      await alpha.write('k', 'a');
      await beta.write('k', 'b');

      // Read the backing map directly: this is what actually lands in
      // localStorage (under shared_preferences own `flutter.` prefix).
      expect(origin.keys.toSet(), <String>{'alpha_app.k', 'beta_app.k'});
      expect(origin['alpha_app.k'], 'a');
      expect(origin['beta_app.k'], 'b');
      expect(
        origin.containsKey('k'),
        isFalse,
        reason: 'an unprefixed key reached the shared origin',
      );
    });

    test('the un-namespaced store is what regresses — control', () async {
      // The control that makes the four tests above evidence rather than
      // decoration: with no namespace the SAME two writes collide, and both
      // reads return one app's value with no error. If this ever stops being
      // true the tests above are no longer testing anything.
      final KeyValueStore raw = InMemoryKeyValueStore();
      await raw.write('theme_mode', 'dark');
      await raw.write('theme_mode', 'light');
      expect(await raw.read('theme_mode'), 'light');
    });
  });

  group('InMemorySecureStore', () {
    test('write/read/delete round-trip and deleteAll clears everything',
        () async {
      final SecureStore s = InMemorySecureStore();
      await s.write('token', 'abc');
      await s.write('refresh', 'xyz');
      expect(await s.read('token'), 'abc');

      await s.delete('token');
      expect(await s.read('token'), isNull);
      expect(await s.read('refresh'), 'xyz');

      await s.deleteAll();
      expect(await s.read('refresh'), isNull);
    });
  });

  group('Entitlement(s) JSON round-trip (entitlement-cache persistence)', () {
    test('Entitlement round-trips with and without expires_at', () {
      final Entitlement lifetime = Entitlement.fromJson(<String, dynamic>{
        'entitlement': 'pro',
        'product_id': 'subscriptiontracker_pro',
        'store': 'paddle',
        'is_active': true,
      });
      final Entitlement back = Entitlement.fromJson(lifetime.toJson());
      expect(back.entitlement, 'pro');
      expect(back.productId, 'subscriptiontracker_pro');
      expect(back.store, 'paddle');
      expect(back.isActive, isTrue);
      expect(back.expiresAt, isNull);

      final DateTime exp = DateTime.utc(2027, 1, 2, 3, 4, 5);
      final Entitlement sub = Entitlement(
        entitlement: 'pro',
        productId: 'p',
        store: 'paddle',
        isActive: true,
        expiresAt: exp,
      );
      expect(Entitlement.fromJson(sub.toJson()).expiresAt, exp);
    });

    test('Entitlements round-trips its items', () {
      final Entitlements e = Entitlements(
        appId: 'subscriptiontracker',
        isPro: true,
        items: <Entitlement>[
          const Entitlement(
            entitlement: 'pro',
            productId: 'subscriptiontracker_pro',
            store: 'paddle',
            isActive: true,
          ),
        ],
      );
      final Entitlements back = Entitlements.fromJson(e.toJson());
      expect(back.appId, 'subscriptiontracker');
      expect(back.isPro, isTrue);
      expect(back.items, hasLength(1));
      expect(back.items.first.productId, 'subscriptiontracker_pro');
    });
  });
}

/// A [KeyValueStore] over a map the TEST still holds a reference to — one
/// browser origin's `localStorage`, modelled honestly.
///
/// `InMemoryKeyValueStore` deliberately copies its seed, which is right for a
/// fixture and wrong here: the whole point is to inspect the raw keys two
/// namespaced stores actually deposit in the ONE store they share.
class _SharedOriginStore implements KeyValueStore {
  _SharedOriginStore(this._store);

  final Map<String, String> _store;

  @override
  Future<String?> read(String key) async => _store[key];

  @override
  Future<void> write(String key, String value) async => _store[key] = value;

  @override
  Future<void> remove(String key) async => _store.remove(key);

  @override
  Future<bool> containsKey(String key) async => _store.containsKey(key);
}
