import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Neutral fixture ids, never a real app name — the adapter must not care which
// app it belongs to, and a test that names one invites a literal into the
// production seam later.
const String _alpha = 'alpha_app';
const String _beta = 'beta_app';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test('write / read / containsKey / remove round-trip', () async {
    final KeyValueStore kv = await PrefsKeyValueStore.create(appId: _alpha);
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
  });

  test('reads values already present in the store', () async {
    // Present under the QUALIFIED key: that is what a previous launch of this
    // app wrote, and the only thing this app is entitled to read.
    SharedPreferences.setMockInitialValues(<String, Object>{'alpha_app.a': '1'});
    final KeyValueStore kv = await PrefsKeyValueStore.create(appId: _alpha);
    expect(await kv.read('a'), '1');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE REGRESSION THIS UNIT EXISTS TO PREVENT, at the adapter level.
  //
  // `SharedPreferences` here is ONE mock store — the honest model of the ONE
  // browser origin every app now serves from (`nikatru.com/<app>`, not a
  // per-app subdomain). Web storage is origin-scoped, never path-scoped, and
  // `shared_preferences` on web writes `flutter.<key>` into that origin's
  // localStorage. Without a namespace these two stores are the same store.
  // ───────────────────────────────────────────────────────────────────────────
  group('two apps, ONE shared backing store', () {
    test('the same logical key reads back DIFFERENT values per app', () async {
      final SharedPreferences shared = await SharedPreferences.getInstance();
      final KeyValueStore alpha = PrefsKeyValueStore(shared, appId: _alpha);
      final KeyValueStore beta = PrefsKeyValueStore(shared, appId: _beta);

      await alpha.write('theme_mode', 'dark');
      await beta.write('theme_mode', 'light');

      expect(await alpha.read('theme_mode'), 'dark');
      expect(
        await beta.read('theme_mode'),
        'light',
        reason: 'one app read the other app value off the shared origin',
      );

      // And neither can see the other at all.
      await alpha.write('only_alpha', 'yes');
      expect(await beta.containsKey('only_alpha'), isFalse);

      // A remove in one app leaves the other intact — a sign-out must not wipe
      // a sibling app that happens to share the origin.
      await beta.remove('theme_mode');
      expect(await beta.read('theme_mode'), isNull);
      expect(await alpha.read('theme_mode'), 'dark');
    });

    test('the RAW prefs keys carry the app id, and no bare key is written',
        () async {
      final SharedPreferences shared = await SharedPreferences.getInstance();
      await PrefsKeyValueStore(shared, appId: _alpha).write('k', 'a');
      await PrefsKeyValueStore(shared, appId: _beta).write('k', 'b');

      // Read through the plugin directly: this is what actually lands on disk /
      // in localStorage, which is the only place the collision could happen.
      expect(shared.getString('alpha_app.k'), 'a');
      expect(shared.getString('beta_app.k'), 'b');
      expect(
        shared.containsKey('k'),
        isFalse,
        reason: 'an unprefixed key reached the shared origin',
      );
      expect(shared.getKeys(), <String>{'alpha_app.k', 'beta_app.k'});
    });

    test('the store reports the namespace it writes under', () async {
      final PrefsKeyValueStore kv =
          await PrefsKeyValueStore.create(appId: _alpha);
      expect(kv.namespace, StorageNamespace(_alpha));
      expect(kv.namespace.qualify('k'), 'alpha_app.k');
    });

    test('an app id that is not a safe prefix is refused at construction',
        () async {
      final SharedPreferences shared = await SharedPreferences.getInstance();
      // A dot inside the id would make one app id a prefix of another, i.e. a
      // namespace that silently leaks. Refused loudly instead.
      expect(
        () => PrefsKeyValueStore(shared, appId: 'alpha.app'),
        throwsArgumentError,
      );
      expect(() => PrefsKeyValueStore(shared, appId: ''), throwsArgumentError);
    });
  });

  test('backs a persisted ConfigCache (hydrate round-trip)', () async {
    // Proves the adapter satisfies the core ConfigCache persistence contract.
    final KeyValueStore kv = await PrefsKeyValueStore.create(appId: _alpha);
    // [pipeline C-10] a neutral fixture, not a real app's name: core carries no
    // app-specific default any more, and neither should its adapters' tests.
    const AppConfig fixture = AppConfig(
      appId: 'fixture',
      apiBaseUrl: 'https://api.example/v1',
      features: <String, bool>{},
      paywall: PaywallConfig(enabled: false),
      contentPack: null,
      copy: <String, String>{},
      minSupportedVersion: '1.0.0',
    );
    final AppConfig canary = fixture.copyWith(
      apiBaseUrl: 'https://persisted.example/v1',
    );
    ConfigCache(store: kv).put(canary);
    // put()'s write-through is fire-and-forget; let it settle before reading.
    await Future<void>.delayed(Duration.zero);

    final ConfigCache fresh = ConfigCache(store: kv);
    await fresh.hydrate(<String>['fixture']);
    expect(fresh.get('fixture')!.apiBaseUrl, 'https://persisted.example/v1');
  });
}
