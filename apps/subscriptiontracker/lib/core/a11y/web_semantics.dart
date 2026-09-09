import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/semantics.dart';

/// 🔴 THE WEB BUILD HAD NO ACCESSIBILITY TREE AT ALL, AND NOTHING WENT RED.
///
/// Flutter web does not build the semantics DOM until something asks for it.
/// The engine ships a hidden "Enable accessibility" placeholder button and only
/// starts emitting `aria-*` nodes once that button is activated — so a screen
/// reader landing on the served page finds a `<flt-glass-pane>` with a canvas
/// inside it and nothing else. Measured: the only occurrence of
/// `ensureSemantics` anywhere in this app's tree was a PROSE MENTION in a
/// comment at `lib/app.dart:451` describing what a widget TEST does. A comment
/// naming an API is not a call to it.
///
/// The reason this survived a guard sweep is worth recording, because it will
/// recur: `tooling/ci/assert-a11y-coverage.mjs` reports this app at full
/// coverage, and it is not wrong. It measures WIDGET semantics — that every
/// screen's controls carry labels — by walking the Dart tree. This defect is a
/// BINDING-LEVEL switch one layer below every widget: the labels are all
/// present and correct, and on web nothing ever asks the framework to compile
/// them into a tree. No widget test can see it either, because `flutter_test`
/// runs with semantics forced on whenever a `SemanticsHandle` is held by the
/// harness, which is exactly the state this function creates. The bug is
/// "production does not do what the test harness does for free".
///
/// [kIsWeb] is a compile-time constant, so the six non-web targets tree-shake
/// the call away entirely; they get their semantics tree from the platform
/// (TalkBack / VoiceOver / Narrator / Orca announce themselves and the engine
/// turns semantics on in response), which is why this is web-only and not a
/// blanket "always on". Forcing it on everywhere would keep the semantics tree
/// compiled on every frame on five platforms that had already asked for it
/// only when a reader was actually running.
///
/// The returned handle is DELIBERATELY NEVER DISPOSED. `SemanticsBinding`
/// counts outstanding handles and drops back to "collect nothing" the moment
/// the count reaches zero (`_didDisposeSemanticsHandle`), so holding one for
/// the process lifetime is the documented way to say "this app always has a
/// client interested in semantics". Storing it and disposing it later would
/// re-create the defect.
///
/// [isWeb] and [binding] are injected so the two arms are decidable from a unit
/// test. Without them this would be one unreachable `if` guarded by a
/// compile-time constant that is `false` under `flutter test` — i.e. a line no
/// test in this repository could ever execute, which is the same as an
/// unproven line.
SemanticsHandle? enableWebSemantics({
  bool isWeb = kIsWeb,
  SemanticsBinding? binding,
}) {
  if (!isWeb) return null;
  return (binding ?? SemanticsBinding.instance).ensureSemantics();
}
