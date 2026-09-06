import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// One carousel card. The WORDS are per-app and arrive already resolved — see
/// [OnboardingView] for why the resolution stays in the adapter.
@immutable
class OnboardingPage {
  const OnboardingPage({required this.title, required this.body});

  final String title;
  final String body;
}

/// First-run onboarding — [pipeline C-13].
///
/// 🏗️ THE BODY OF `OnboardingScreen`, MOVED HERE BY [ADR 067] decision 2. The
/// brick keeps an adapter of the same name, and TWO things stayed there:
/// `onboardingSeenProvider` (Riverpod, which this package declares none of) and
/// the `AppConfig.copy` override read with its l10n fallback — which
/// `assert-config-registry.mjs` (`:947-990`) and
/// `assert-stamp-properties.mjs:1094` both anchor in the brick file by the
/// literal `_copy(cfg, 'onboarding.1.title', l10n.onboarding1Title)`.
///
/// 🔴 THE REFUSAL THIS REPLACES was "the content is app-specific", which is true
/// of the WORDS and false of the MECHANISM. `AppConfig.copy` is a runtime
/// copy-override map that already existed, so the carousel is CHASSIS and the
/// words are per-app config. Every stamped app gets a working first run without
/// writing one, and an app that has something better to say overrides three
/// strings in its config — no code, no release.
///
/// ⚠️ THE SPLASH HALF IS NOT HERE AND IS NOT COMING. A splash screen is native
/// platform configuration (a launch storyboard on iOS, a launch drawable on
/// Android); a Dart one renders AFTER the native splash has already been shown
/// and therefore adds a SECOND flash rather than removing the first. That
/// refusal survived checking and stands.
class OnboardingView extends StatefulWidget {
  const OnboardingView({
    required this.pages,
    required this.onFinish,
    super.key,
  });

  /// SKIP is present on every page and equally reachable — see the control.
  static const Key skipButton = Key('onboardingSkip');

  /// "Next" on every page but the last, "Start" on the last. One key, because
  /// it is one control with two labels.
  static const Key advanceButton = Key('onboardingAdvance');

  final List<OnboardingPage> pages;

  /// Called by SKIP and by the last page's primary action alike: onboarding is
  /// SEEN either way, and the flag write plus the navigation both need the
  /// adapter's `ref` and `GoRouter`.
  final VoidCallback onFinish;

  @override
  State<OnboardingView> createState() => _OnboardingViewState();
}

class _OnboardingViewState extends State<OnboardingView> {
  final PageController _pages = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final List<OnboardingPage> pages = widget.pages;
    final bool isLast = _index == pages.length - 1;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: <Widget>[
            // SKIP is present on every page and equally reachable. An
            // onboarding a user cannot leave is a wall, not an introduction —
            // and both stores treat an unskippable first run as a dark pattern.
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: OnboardingView.skipButton,
                onPressed: widget.onFinish,
                child: Text(l10n.onboardingSkip),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pages,
                itemCount: pages.length,
                onPageChanged: (int i) => setState(() => _index = i),
                // 🔴 THE ONE UNCONSTRAINED SCREEN WHERE THE DAMAGE IS
                // TYPOGRAPHIC. This was `Padding(symmetric horizontal: 32)` and
                // nothing else, so on a 1280 px window the onboarding body ran
                // 1216 px lines — roughly 200 characters, three times the 45–75
                // the eye can track without losing the line return. A carousel
                // whose whole job is to introduce the app was the hardest thing
                // in it to read, and only on the widest screens, which is why
                // nobody hit it on a phone.
                //
                // `.reading` (720) and not the default cap: this is continuous
                // PROSE, and [AppBreakpoints.reading] is the constant that says
                // so. The padding stays INSIDE the cap, which is exactly what
                // the `Padding` it replaces did — so at any width below 720
                // (every phone, every split pane) this renders pixel-identical
                // to before.
                //
                // ⚠️ THE COLUMN KEEPS `MainAxisAlignment.center` AND STILL
                // FILLS THE PAGE. `ContentPane` aligns to topCenter, but its
                // `Align` hands the child LOOSENED constraints rather than
                // tight ones, and a `Column` with the default
                // `mainAxisSize.max` takes the full height it is offered — so
                // the vertical centring this carousel wants is untouched. Only
                // the horizontal half changed.
                itemBuilder: (BuildContext context, int i) =>
                    ContentPane.reading(
                      padding: const EdgeInsets.symmetric(horizontal: 32),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          Text(
                            pages[i].title,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            pages[i].body,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      ),
                    ),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                for (int i = 0; i < pages.length; i++)
                  Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(
                      i == _index ? Icons.circle : Icons.circle_outlined,
                      size: 10,
                      semanticLabel: null,
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: OnboardingView.advanceButton,
                  onPressed: isLast
                      ? widget.onFinish
                      : () => _pages.nextPage(
                          duration: const Duration(milliseconds: 250),
                          curve: Curves.easeOut,
                        ),
                  child: Text(
                    isLast ? l10n.onboardingStart : l10n.onboardingNext,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
