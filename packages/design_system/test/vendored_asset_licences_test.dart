import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// Proof that the CC BY 4.0 notice for the vendored Material Icons font
/// ACTUALLY REACHES `LicenseRegistry`.
///
/// 🔴 WHY THIS FILE IS LOAD-BEARING AND NOT CEREMONY.
/// `tooling/ci/assert-licence-register.mjs` discharges the attribution
/// obligation by checking that `attributedIn` names a **file that exists**
/// (`existsSync`). That is all it can check from outside Dart — so the register
/// row would stay green if this file were emptied to a no-op tomorrow, or if the
/// `addLicense` call were deleted while the file remained. **The guard proves a
/// path resolves; only this test proves the licence is served.** That gap is
/// exactly the "fail-closed seam with no proven open path" shape the corpus
/// keeps getting caught by, so the seam gets an executable open path here.
///
/// Each assertion below names the CC BY 4.0 clause it enforces. Deleting any one
/// of the six retentions from the notice turns a specific case red rather than
/// dropping coverage silently.
void main() {
  setUp(() {
    // Both resets matter and they are NOT the same thing. `LicenseRegistry` is
    // process-wide, and the latch inside the subject is module-global — so
    // without the second reset, every case after the first would exercise the
    // early-return path and assert on the FIRST case's registration. That is a
    // suite that passes while testing nothing after case one.
    LicenseRegistry.reset();
    debugResetVendoredAssetLicences();
  });

  /// The entry filed under [package]. ⏱ 2026-09-12: this used to be
  /// `found.single`, because the collector yielded ONE notice. It yields two
  /// since `Roboto-Regular.ttf` started arriving in a stamped app's web bundle
  /// (asset-register row `flutter-roboto`), and the count is asserted rather
  /// than tolerated — a collector that silently stops yielding one of them is
  /// exactly the regression this file exists to catch.
  Future<LicenseEntry> entryFor(String package) async {
    registerVendoredAssetLicences();
    final List<LicenseEntry> found = await LicenseRegistry.licenses.toList();
    expect(
      found,
      hasLength(2),
      reason: 'Expected two entries from the vendored-asset collector, one per '
          'vendored font. Zero means registerVendoredAssetLicences() no longer '
          'reaches LicenseRegistry.addLicense — in which case the asset '
          'register rows point at a file that discharges nothing and both '
          'licence conditions are unmet again, silently.',
    );
    return found.firstWhere(
      (LicenseEntry e) => e.packages.contains(package),
      orElse: () => throw StateError(
        'No entry is filed under "$package". The notices present are: '
        '${found.map((LicenseEntry e) => e.packages.join('+')).join(', ')}.',
      ),
    );
  }

  Future<LicenseEntry> theEntry() => entryFor('flutter-material-icons');
  Future<LicenseEntry> theRobotoEntry() => entryFor('flutter-roboto');

  String textOf(LicenseEntry e) =>
      e.paragraphs.map((LicenseParagraph p) => p.text).join('\n');

  test('THE FALSIFIER · nothing is registered until the call is made',
      () async {
    // If this fails, every assertion below is vacuous: the entry would be
    // arriving from somewhere else and this file would be measuring Flutter's
    // own collector rather than the subject.
    final List<LicenseEntry> before = await LicenseRegistry.licenses.toList();
    expect(
      before,
      isEmpty,
      reason:
          'LicenseRegistry already had entries BEFORE the subject ran, so a '
          'passing test below would not be evidence that the subject did '
          'anything. Check setUp ordering and LicenseRegistry.reset().',
    );
  });

  test('the entry is filed under the package name the register names',
      () async {
    final LicenseEntry e = await theEntry();
    expect(
      e.packages,
      contains('flutter-material-icons'),
      reason:
          'The package key must match the asset-register row id, or a reader '
          'cross-checking the register against the shipped LicensePage finds '
          'nothing under that name.',
    );
  });

  group('CC BY 4.0 §3(a)(1)(A) — the five retentions', () {
    test('(i) identification of the creator', () async {
      expect(textOf(await theEntry()), contains('Google'));
    });

    test('(ii) a copyright notice', () async {
      expect(textOf(await theEntry()), contains('Copyright'));
    });

    test('(iii) a notice referring to this Public License', () async {
      final String t = textOf(await theEntry());
      expect(t, contains('Creative Commons Attribution 4.0 International'));
      // §3(a)(2) lets a URI carry the required information; without it the
      // notice references a licence the reader cannot obtain.
      expect(t, contains('creativecommons.org/licenses/by/4.0/legalcode'));
    });

    test('(iv) a notice referring to the disclaimer of warranties', () async {
      final String t = textOf(await theEntry());
      expect(t, contains('DISCLAIMER'));
      expect(t, contains('as-is'));
    });

    test('(v) a URI to the Licensed Material', () async {
      expect(
        textOf(await theEntry()),
        contains('github.com/google/material-design-icons'),
      );
    });
  });

  test('§3(a)(1)(B) — the MODIFICATION is stated, because the font is subset',
      () async {
    // The half nobody was looking at. Tree-shaking rewrites the font
    // (1,645,184 -> 11,524 bytes measured), so this is an adaptation and the
    // duty to indicate modification is live ON TOP OF the five retentions.
    final String t = textOf(await theEntry());
    expect(t, contains('MODIFIED'));
    expect(
      t.toLowerCase(),
      anyOf(contains('subset'), contains('tree-shaken')),
      reason:
          'The notice must say HOW it was modified. "Modified" with no stated '
          'modification is not an indication, it is a hedge.',
    );
  });

  group('Apache-2.0 — the Roboto the SDK vendors, a DIFFERENT licence', () {
    // ⏱ 2026-09-12. `assert-licence-register.mjs --bundle` failed the app-brick
    // job on `Roboto-Regular.ttf ships … and has NO row`: the stamped probe,
    // built on Flutter 3.47.2 with --no-web-resources-cdn, emits the font. The
    // licence is read from the bytes the SDK vendors (roboto_license.txt in
    // material_fonts/, "Apache License / Version 2.0"), NOT from the icon font
    // beside it in the same artifact, which is CC BY 4.0.

    test('the entry is filed under the package name the register names',
        () async {
      expect((await theRobotoEntry()).packages, contains('flutter-roboto'));
    });

    test('§4(c) — the creator and the copyright notice are retained', () async {
      final String t = textOf(await theRobotoEntry());
      expect(t, contains('Google'));
      expect(t, contains('Copyright'));
    });

    test('§4(a) — recipients are given the License, and where to obtain it',
        () async {
      final String t = textOf(await theRobotoEntry());
      expect(t, contains('Apache License, Version 2.0'));
      expect(t, contains('apache.org/licenses/LICENSE-2.0'));
    });

    test('§7/§8 — the warranty disclaimer is carried', () async {
      final String t = textOf(await theRobotoEntry());
      expect(t, contains('AS IS'));
      expect(t, contains('WITHOUT'));
    });

    test('§4(b) — the change notice says what we did, which is nothing',
        () async {
      expect(textOf(await theRobotoEntry()), contains('MODIFICATIONS'));
    });

    test('the two notices are NOT the same licence, and cannot be merged',
        () async {
      final String roboto = textOf(await theRobotoEntry());
      final String icons = textOf(await theEntry());
      expect(
        roboto.contains('Creative Commons'),
        isFalse,
        reason:
            'Roboto is Apache-2.0. A CC BY notice on it would attribute the '
            'wrong licence to shipped bytes, which is worse than no notice '
            'because it reads as a discharged duty.',
      );
      expect(icons.contains('Apache License, Version 2.0'), isFalse);
    });
  });

  test('registration is IDEMPOTENT — a second call adds no duplicate',
      () async {
    registerVendoredAssetLicences();
    registerVendoredAssetLicences();
    registerVendoredAssetLicences();
    final List<LicenseEntry> found = await LicenseRegistry.licenses.toList();
    expect(
      found,
      hasLength(2),
      reason:
          'Three calls produced ${found.length} entries against the two the '
          'collector yields. The stamped chassis and the app can both call '
          'this; without the latch the LicensePage shows the same notices once '
          'per caller, which reads as a bug in the app.',
    );
    expect(vendoredAssetLicencesRegistered, isTrue);
  });
}
