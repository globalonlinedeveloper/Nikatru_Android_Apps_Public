import 'package:flutter/material.dart';

/// Calls [onBackground] on every edge that means "this app is on its way out".
///
/// 🏗️ MOVED HERE BY [ADR 067] decision 2 from the brick's `AnalyticsGate`,
/// which no longer needs to be a `WidgetsBindingObserver` at all. The adapter
/// keeps the one Riverpod line the callback runs —
/// `ref.read(analyticsProvider).valueOrNull?.flush()` — because the recorder is
/// a provider and this package declares no Riverpod.
///
/// 🔴 FOUR STATES, AND `inactive` IS THE ONE THAT COVERS DESKTOP — [11]E-4a.
///
/// Read off dart:ui's own documentation of the enum, not off habit:
///   · `paused`  — "This state is only entered on iOS and Android."
///   · `detached`— entered on iOS, Android and web.
///   · `hidden`  — on non-web desktop this means MINIMIZED or moved to a
///                 desktop that is no longer visible. Closing a window is not
///                 minimizing it.
///   · `inactive`— on non-web desktop, "an application that is not in the
///                 foreground, but still has visible windows".
/// So on Windows, macOS and Linux the previous three-state set fired on exactly
/// one path — minimize — and never on the way out of the app. `inactive` is the
/// last edge a desktop app reliably reports before the process ends.
///
/// ⚠️ THE MOBILE COST, MEASURED RATHER THAN WAVED AWAY. On iOS and Android
/// `inactive` also fires on transient interruptions: the notification shade,
/// the app switcher, a phone call, a system dialog, split screen. Two things
/// bound what that costs:
///   1. `flush()` returns immediately on an empty queue, so an interruption
///      with nothing queued costs nothing at all — no request, no wakeup.
///   2. When there IS something queued, the worst case is one request per
///      event, which is the same ceiling `batchSize: 1` would have. Each event
///      still ships at most once; the sink dedups on `event_id` regardless.
/// Against that: on mobile the framework synthesizes `inactive` → `hidden` →
/// `paused` on every backgrounding, so for the ordinary background transition
/// this does not ADD a request — it moves the same one earlier, before the OS
/// has a chance to freeze the process mid-POST.
///
/// Not gated behind a platform check on purpose. A `Platform.isWindows` branch
/// in the chassis would buy a bounded saving on transient mobile interruptions
/// at the price of a per-platform behaviour in the one file every stamped app
/// inherits — the same trade `AnalyticsRecorder` records for refusing a
/// connectivity probe: one behaviour on all six platforms, no plugin, no
/// branch.
class AppLifecycleFlush extends StatefulWidget {
  const AppLifecycleFlush({
    required this.onBackground,
    required this.child,
    super.key,
  });

  /// Fire-and-forget by contract: the framework will not wait, and a failed send
  /// just leaves the batch queued for next launch.
  ///
  /// This is the BEST-EFFORT half of delivery, and it is not sufficient on its
  /// own — a page unload beats an unawaited POST, and a killed process reports
  /// nothing at all. The guarantee lives in core's `kFlushInterval` deadline;
  /// this only makes the common case earlier.
  final VoidCallback onBackground;

  final Widget child;

  @override
  State<AppLifecycleFlush> createState() => _AppLifecycleFlushState();
}

class _AppLifecycleFlushState extends State<AppLifecycleFlush>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      widget.onBackground();
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
