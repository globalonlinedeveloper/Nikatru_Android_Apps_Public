import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The first-run analytics consent question — the BODY, moved here by
/// [ADR 067] decision 2.
///
/// 🏗️ WHAT STAYED IN THE BRICK, AND WHY EACH THING DID. The adapter keeps
/// `_ConsentPrompt`, a `ConsumerWidget` that reads nothing and writes one thing:
/// `recordAnalyticsConsent(ref, granted: granted)`. That call is Riverpod, this
/// package declares none, and `tooling/ci/assert-seams-wired.mjs` asserts a
/// non-test caller of it exists — so the writer stays on the caller's side of
/// the boundary and this widget takes a callback, exactly the pattern
/// `destructive_confirm_dialog.dart` records.
///
/// 🔴 THE SCROLL VIEW IS A DEFECT REPAIR WITH A NUMBER ON IT, AND IT TRAVELLED
/// WITH THE BODY. `tooling/ci/assert-consent-withdrawal-surface.mjs` limb 4
/// derives the prompt from the tree — whichever widget class renders
/// `consentPrivacy` IS the prompt — and fails the build if that class has no
/// scroller. Since the class that renders the sentence is now THIS one, that
/// limb follows the delegation to find it. Deleting the `SingleChildScrollView`
/// below reddens the build for every root, as it did when the body lived in the
/// brick.
///
/// Deliberately plain Material so a stamped app owes the design system nothing
/// for it — restyle freely, but keep BOTH answers equally prominent (see below).
class ConsentPromptCard extends StatelessWidget {
  const ConsentPromptCard({
    required this.appName,
    required this.onAnswer,
    super.key,
  });

  /// The app's display name, which the title and the accessible label both
  /// spell. It arrives resolved: `AppConfig` is per-app and stays in the brick.
  final String appName;

  /// The one decision this surface can produce. Not awaited by the caller
  /// either: the choice applies in memory immediately and the upload is
  /// best-effort, so blocking the button on a network round trip would only make
  /// a declined choice feel like a broken one.
  final void Function({required bool granted}) onAnswer;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ChassisLocalizations l10n = context.chassisL10n;
    return Positioned.fill(
      // 🔴 THE DIALOG ROLE, RESTORED BY HAND. `ModalRoute` sets `scopesRoute`
      // on every pushed route; an inline scrim is not a route and gets none of
      // it, so a screen reader had no way to say a decision was being asked
      // for. With the background excluded by [ConsentScrim], this node is the
      // whole accessible tree while the question is open.
      child: Semantics(
        scopesRoute: true,
        namesRoute: true,
        explicitChildNodes: true,
        label: l10n.consentTitle(appName),
        child: ColoredBox(
          color: Colors.black54,
          // KEEPS `Center`, takes only the WIDTH from the chassis. This is a
          // modal scrim over a dimmed app: sitting in the middle of the screen
          // is the design, not an accident, so `ContentPane` (which pins to the
          // top) would be the wrong primitive here. The 420 literal is gone
          // either way — that was the copy, repeated in five other files.
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
                child: Material(
                  color: theme.colorScheme.surface,
                  borderRadius: BorderRadius.circular(20),
                  // Clipped because the content scrolls: without it the first
                  // and last lines paint over the rounded corners as they pass
                  // under them.
                  clipBehavior: Clip.antiAlias,
                  // 🔴 SCROLLABLE, AND THIS IS A DEFECT REPAIR WITH A NUMBER ON
                  // IT — NOT DEFENSIVE PADDING. `Column(mainAxisSize: min)`
                  // inside `Center` is unbounded in the way that matters: it
                  // takes the height it wants and overflows the screen when the
                  // text is large. Measured on the real app at the largest text
                  // this chassis PERMITS (`NikatruApp.maxTextScale` is 2.0 — in
                  // range by design, not an extreme):
                  //   · 360×640 @2.0 en → RenderFlex overflowed by 644 px
                  //   · 360×640 @2.0 ta → 1180 px
                  // and the "Allow" button's rect came back at y 1140→1220 on a
                  // 640-tall screen, i.e. entirely below the fold with no way to
                  // reach it. The control was clean at the same size with the
                  // scrim off, so the overflowing box was this Column and not a
                  // screen beneath it. An unanswerable modal is worse than an
                  // ugly one: `ColoredBox` is hit-test-opaque, so the app was
                  // unusable, and because the recorder is fail-closed the
                  // silence would have looked exactly like a user who declined.
                  //
                  // KEEP THE SCROLL VIEW. A stamped app is free to restyle this
                  // card; deleting the scroll view re-opens the defect, and
                  // `assert-consent-withdrawal-surface.mjs` limb 4 fails the
                  // build for every root if it goes.
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            l10n.consentTitle(appName),
                            style: theme.textTheme.titleLarge,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            l10n.consentBody,
                            style: theme.textTheme.bodyMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            l10n.consentPrivacy,
                            style: theme.textTheme.bodySmall,
                          ),
                          const SizedBox(height: 16),
                          // Both answers get the same size and weight ON
                          // PURPOSE. A prominent "Allow" beside a faint "No
                          // thanks" is the dark pattern consent rules exist to
                          // stop, and it also poisons the data with pressured
                          // yeses.
                          Row(
                            children: <Widget>[
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () => onAnswer(granted: false),
                                  child: Text(l10n.consentDecline),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: FilledButton(
                                  onPressed: () => onAnswer(granted: true),
                                  child: Text(l10n.consentAllow),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The scrim's MODALITY — the two lines that buy back what `ModalRoute` used to
/// give free.
///
/// 🔴 AN INLINE SCRIM IS NOT MODAL BY ITSELF, AND THIS WIDGET IS WHY IT IS —
/// measured on the stamped app, not assumed. Before `ExcludeSemantics` and
/// `ExcludeFocus`, with the prompt up, a walk of the compiled semantics tree
/// found the screen BEHIND the scrim fully exposed, its buttons still carrying
/// live tap actions. Semantic taps dispatch straight to the widget and DO NOT
/// hit-test, so an opaque `ColoredBox` stops a finger and stops nothing for
/// TalkBack or VoiceOver: a screen-reader user could drive the app underneath a
/// modal they were never told they were inside.
///
/// `excluding:` rather than conditionally WRAPPING, on purpose: the widget types
/// stay in the tree across the answer, so recording the decision does not
/// remount the whole app subtree and throw away the router's state.
///
/// Rendered INLINE rather than via `showDialog` because the gate that mounts
/// this sits in [NikatruApp]'s `builder`, which is ABOVE the router's Navigator,
/// so `showDialog` there has no Navigator to push onto. An inline scrim also
/// disappears reactively the moment the decision is recorded, with no post-frame
/// callback and no "did I already ask?" bookkeeping to get wrong.
class ConsentScrim extends StatelessWidget {
  const ConsentScrim({
    required this.asking,
    required this.prompt,
    required this.child,
    super.key,
  });

  /// True while the question is open. The caller decides — that judgement reads
  /// two providers and stays in the brick adapter.
  final bool asking;

  /// The question itself, supplied by the caller so the writer that records the
  /// answer never has to cross this package's boundary.
  final Widget prompt;

  /// The app, which stays mounted and merely stops being reachable.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        ExcludeFocus(
          excluding: asking,
          child: ExcludeSemantics(excluding: asking, child: child),
        ),
        if (asking) prompt,
      ],
    );
  }
}
