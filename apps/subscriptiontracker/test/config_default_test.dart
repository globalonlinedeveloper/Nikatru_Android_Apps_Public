import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// [pipeline C-10] The CFG-1 bundled-default contract, MOVED HERE FROM
/// `packages/core/test/config_test.dart`.
///
/// The values it pins used to live in core's `kDefaultConfigs` under a hardcoded
/// `'subscriptiontracker'` key — an app-specific value in shared code, exported from the barrel
/// every stamped app imports. The values moved into this app; this test moved with
/// them, so the protection is relocated rather than lost.
///
/// 🔒 WHAT IT PROTECTS: `kSublyDefaultConfig` must equal the server's
/// authoritative defaults in `services/platform/src/config.ts` `DEFAULT_CONFIGS`.
/// The mirror image of this assertion lives in that Worker's `config.test.ts`, so
/// adding or changing a config field on EITHER side fails the other's lane.
void main() {
  group('bundled default mirrors the server DEFAULT_CONFIGS', () {
    test('kSublyDefaultConfig equals the server contract values', () {
      const core.AppConfig d = kSublyDefaultConfig;
      // DERIVED, NEVER SPELT. This was `expect(d.appId, '<literal>')`, and a
      // literal here is disarmed by any rename that rewrites the whole tree at
      // once: the replace edits the subject and the assertion together, so the
      // test cannot fail. The catalogue is the app id's DECLARATION and is not
      // this file, so a half-done rename now shows up as a real mismatch.
      expect(d.appId, _catalogueSlug());
      expect(d.apiBaseUrl, 'https://subscriptiontracker.api.nikatru.com/v1');
      expect(d.features, <String, bool>{
        'renewals': true,
        'budgets': true,
        'exports': true,
      });
      expect(d.paywall.enabled, isFalse);
      expect(d.contentPack, isNull);
      expect(d.copy, isEmpty);
      expect(d.minSupportedVersion, '1.0.0');
      // `flags` is TYPED on the server too (services/platform/src/types.ts +
      // config.ts `flags: {}`), so adding a field on either side fails the other.
      expect(d.flags, isEmpty);
    });

    test('the default is keyed to THIS app', () {
      expect(kSublyDefaultConfig.appId, AppConfig.appId);
    });
  });

  group('the offline fallback actually resolves', () {
    // The regression this guards: core's kDefaultConfigs is now EMPTY, and
    // appConfigProvider THROWS when the loader cannot produce a config. If the
    // seed were ever dropped from configLoaderProvider, Subly would crash at
    // launch on any network failure — and in demo mode, every launch.
    test('a seeded cache resolves without any network', () {
      final core.ConfigCache cache = core.ConfigCache(
        seed: <String, core.AppConfig>{AppConfig.appId: kSublyDefaultConfig},
      );
      final core.AppConfig? resolved = cache.get(AppConfig.appId);
      expect(resolved, isNotNull, reason: 'offline launch would throw');
      expect(resolved!.apiBaseUrl, 'https://subscriptiontracker.api.nikatru.com/v1');
    });

    test(
      'core no longer answers for this app — the seed is the only source',
      () {
        // Proves the clone tell is genuinely gone from shared code, not merely
        // shadowed by the seed.
        expect(core.defaultConfigFor('subscriptiontracker'), isNull);
        expect(core.kDefaultConfigs, isEmpty);
      },
    );
  });
}

/// The one app id declared in `catalog/apps.json`, read at test time.
///
/// The catalogue is what `services/platform/src/config.ts` builds its served
/// registry from (`buildRegistry`, filtered by APP_ID_PATTERN), so this is the
/// same string the server answers `/config/<id>` for. Reading it here binds the
/// compiled-in client default to the declaration rather than to a second copy.
String _catalogueSlug() {
  final Directory dir = Directory.current;
  for (Directory d = dir; ; d = d.parent) {
    final File f = File('${d.path}/catalog/apps.json');
    if (f.existsSync()) {
      final List<dynamic> rows =
          jsonDecode(f.readAsStringSync()) as List<dynamic>;
      final List<String> slugs = rows
          .map((dynamic r) => (r as Map<String, dynamic>)['slug'] as String)
          .toList();
      // COVERAGE LOST, never a silent pass: with more or fewer than one app
      // there is no unambiguous subject and this must say so rather than pick.
      expect(
        slugs.length,
        1,
        reason:
            'catalog/apps.json must declare exactly one app for this assertion '
            'to have a subject; it declares ${slugs.length}.',
      );
      return slugs.single;
    }
    if (d.path == d.parent.path) break;
  }
  fail('catalog/apps.json was not found above ${dir.path} — COVERAGE LOST.');
}
