// The web build shipped with NO accessibility tree. This file is the proof
// that it now has one, and it has to prove two separate things, because the
// defect needed both to be true at once:
//
//   1. `enableWebSemantics` turns semantics collection ON for the web arm and
//      leaves the other six targets alone.
//   2. `main()` actually calls it.
//
// (1) without (2) is a helper nobody runs — which is the state the tree was in
// before, since `lib/app.dart` already NAMED `ensureSemantics` in a comment.
// (2) without (1) is a call to something that does nothing. Each limb below is
// mutation-proven in the header comment above it: it says what edit turns it
// red, so a future reader can check the limb still bites without guessing.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/a11y/web_semantics.dart';

void main() {
  // `SemanticsBinding.instance` needs a binding, and the delta assertions below
  // need one that is stable across the group.
  final TestWidgetsFlutterBinding binding =
      TestWidgetsFlutterBinding.ensureInitialized();

  group('enableWebSemantics', () {
    // MUTATION: delete the `if (!isWeb) return null;` line and this goes red —
    // the non-web arm would take a handle and the count would move.
    test('does nothing off web', () {
      final int before = binding.debugOutstandingSemanticsHandles;
      final SemanticsHandle? handle = enableWebSemantics(
        isWeb: false,
        binding: binding,
      );
      expect(
        handle,
        isNull,
        reason:
            'the five desktop/mobile targets get their semantics tree when the '
            'platform asks for it; taking a permanent handle there would keep '
            'the tree compiled on every frame for readers that are not running',
      );
      expect(binding.debugOutstandingSemanticsHandles, before);
    });

    // MUTATION: invert the condition to `if (isWeb) return null;`, or replace
    // the body with `return null;`, and this goes red on both expectations.
    // This is the limb that stands in for the shipped defect: before the fix
    // the whole function did not exist and NOTHING in the tree called
    // `ensureSemantics()` outside a test harness.
    test('takes a semantics handle on web, and semantics become enabled', () {
      final int before = binding.debugOutstandingSemanticsHandles;
      final SemanticsHandle? handle = enableWebSemantics(
        isWeb: true,
        binding: binding,
      );
      expect(handle, isNotNull);
      expect(
        binding.debugOutstandingSemanticsHandles,
        before + 1,
        reason:
            'exactly one handle — the count is what SemanticsBinding drops to '
            'zero on to stop collecting, so "one more than before" is the '
            'whole mechanism',
      );
      expect(
        binding.semanticsEnabled,
        isTrue,
        reason:
            'the observable consequence: with a handle outstanding the '
            'framework compiles the semantics tree, which on web is what emits '
            'the aria nodes a screen reader reads',
      );
      // Released so the two limbs do not depend on execution order and the
      // binding is handed back to the rest of the suite as it was found.
      handle!.dispose();
      expect(binding.debugOutstandingSemanticsHandles, before);
    });
  });

  // The half a unit test cannot reach. `kIsWeb` is a compile-time `false` under
  // `flutter test`, so the production call site is a line no Dart test can
  // execute; what IS decidable is that the line exists. Read from source with
  // comments stripped, because the defect being closed was PRECISELY a
  // comment that named the API without calling it — a grep over raw bytes
  // would have reported this app as fixed for the last three weeks.
  group('main() calls it', () {
    test('lib/main.dart contains a live call, not a mention', () {
      final File f = File('lib/main.dart');
      expect(
        f.existsSync(),
        isTrue,
        reason:
            'the entry point moved; this test would otherwise pass vacuously '
            'over a file that is not there',
      );
      final String raw = f.readAsStringSync();
      final String src = _stripDartComments(raw);

      expect(
        raw.contains('enableWebSemantics'),
        isTrue,
        reason: 'sanity: the name should appear somewhere in the entry point',
      );
      expect(
        RegExp(r'\benableWebSemantics\s*\(').hasMatch(src),
        isTrue,
        reason:
            'lib/main.dart mentions enableWebSemantics only inside a comment. '
            'That is the exact shape of the defect this file closes: '
            'lib/app.dart named `ensureSemantics` in prose while the shipped '
            'web build compiled no semantics tree at all.',
      );

      // It must run before the first frame. `runApp` is inside the telemetry
      // bootstrap's `appRunner` further down the file; a call placed after it
      // is a call made after frames have already been built with no tree.
      final int callAt = src.indexOf(RegExp(r'\benableWebSemantics\s*\('));
      final int runAppAt = src.indexOf(RegExp(r'\brunApp\s*\('));
      expect(
        runAppAt,
        greaterThan(-1),
        reason: 'main() must still call runApp',
      );
      expect(
        callAt,
        lessThan(runAppAt),
        reason:
            'semantics collection has to be on BEFORE the first frame — a '
            'frame built without a handle outstanding carries no tree, and on '
            'web that is what a screen reader arriving at the page reads',
      );
    });
  });
}

/// Strips `//` and `/* */` while leaving string literals intact, so a comment
/// naming an identifier cannot be mistaken for a use of it. Deliberately a
/// local copy: `test/chassis_properties_test.dart` has the same helper and is
/// being edited on another branch right now, and a shared helper would couple
/// two files that have no other reason to move together.
String _stripDartComments(String src) {
  final StringBuffer out = StringBuffer();
  int i = 0;
  String? quote;
  while (i < src.length) {
    final String ch = src[i];
    final String next = i + 1 < src.length ? src[i + 1] : '';
    if (quote != null) {
      out.write(ch);
      if (ch == r'\') {
        if (next.isNotEmpty) out.write(next);
        i += 2;
        continue;
      }
      if (ch == quote) quote = null;
      i++;
      continue;
    }
    if (ch == "'" || ch == '"') {
      quote = ch;
      out.write(ch);
      i++;
      continue;
    }
    if (ch == '/' && next == '/') {
      while (i < src.length && src[i] != '\n') {
        i++;
      }
      continue;
    }
    if (ch == '/' && next == '*') {
      i += 2;
      while (i + 1 < src.length && !(src[i] == '*' && src[i + 1] == '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    out.write(ch);
    i++;
  }
  return out.toString();
}
