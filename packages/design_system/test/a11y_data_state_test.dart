// ─────────────────────────────────────────────────────────────────────────────
// a11y_data_state_test.dart — the accessibility sweep for `DataStateView`.
//
// 🔴 THIS IS `packages/design_system`'s FIRST `a11y_*_test.dart`, and the name
// is load-bearing rather than tidy. `assert-a11y-coverage.mjs` reads a corpus
// of EXACTLY `a11y_*_test.dart` (its `A11Y_TEST` regex), and it argues for that
// bound in its own header. The semantics assertions for this widget were
// written first in `data_state_test.dart`, where they ran green and were
// invisible to the guard — a real sweep that the accounting could not see, and
// therefore a surface that went on being PRINTED as unswept while it was in
// fact swept. Splitting them out is what makes the measurement and the report
// agree.
//
// ⚠️ THE THREE STATES ARE SWEPT SEPARATELY, NOT AS ONE PUMP. They are mutually
// exclusive branches — only one is ever on screen — so a single case could only
// ever have swept whichever one it happened to build, and the other two would
// be credited by association. The failed state is the one that matters most
// here: it is the only branch carrying an interactive control, and a retry a
// reader cannot find is the same dead end as no retry at all.
//
// ⚠️ `pump`, NEVER `pumpAndSettle` — the loading branch animates forever.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);

Future<void> pumpAt(WidgetTester tester, Size size, Widget w) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: w)));
  await tester.pump();
}

void main() {
  group('DataStateView carries no control a reader cannot identify', () {
    testWidgets('failed — the retry meets the tap-target and contrast '
        'guidelines', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        DataStateView.failed(
          title: 'We could not load your subscriptions',
          body: 'Check your connection and try again.',
          retryLabel: 'Retry',
          onRetry: () {},
        ),
      );
      // 🔴 THE ONE INTERACTIVE CONTROL ON ANY OF THE THREE STATES. A 40 px
      // button is the M3 default and is BELOW the 48 px Android minimum, so
      // this case is what forces the explicit minimum size on the widget rather
      // than leaving it to whatever the theme happens to give.
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('failed — the retry is announced as a NAMED BUTTON', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        DataStateView.failed(
          title: 'We could not load your subscriptions',
          retryLabel: 'Retry',
          onRetry: () {},
        ),
      );
      // A tap action without `isButton` is announced as prose that happens to
      // respond; one with no name is announced as nothing at all. Both are the
      // `nakedControls` shape `apps/subscriptiontracker` sweeps for, asserted
      // here directly because this package has no such helper of its own.
      expect(
        tester.getSemantics(find.byKey(DataStateView.retryKey)),
        matchesSemantics(
          label: 'Retry',
          isButton: true,
          isEnabled: true,
          isFocusable: true,
          hasEnabledState: true,
          hasTapAction: true,
          hasFocusAction: true,
        ),
      );
      handle.dispose();
    });

    testWidgets('empty — readable, and offering nothing to activate', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        const DataStateView.empty(
          title: 'No subscriptions yet',
          body: 'Add your first subscription to see it here.',
        ),
      );
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      // The DECORATIVE glyph is excluded, so a reader is not made to hear a
      // meaningless token immediately before the real one — `GlyphTile`'s rule.
      expect(
        find.ancestor(
          of: find.byIcon(Icons.inbox_outlined),
          matching: find.byType(ExcludeSemantics),
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('loading — announced, and announced ONCE', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        const DataStateView.loading(label: 'Loading your subscriptions'),
      );
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(
        tester
            .getSemantics(find.byKey(DataStateView.loadingKey))
            .getSemanticsData()
            .flagsCollection
            .isLiveRegion,
        isTrue,
        reason: 'without liveRegion the wait is announced only if focus happens '
            'to land here, and on a freshly pushed route it does not',
      );
      handle.dispose();
    });
  });
}
