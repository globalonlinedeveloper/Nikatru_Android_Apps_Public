import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// 🔴 [pipeline C-13] `OfflineNotice`'s ONLY CALL SITE — and until 2026-08-06
/// there was none, anywhere in the repository.
///
/// The widget shipped in the design system on 2026-07-28, `offlineMessage` and
/// `retry` shipped in both ARB files, the register recorded the screen as
/// `present` with a valid anchor, and **no user of any stamped app could ever
/// have seen it**. That is the [pipeline C-6] shape: the register asked whether
/// the screen EXISTED and never whether anything reached it, so an absent
/// consumer read exactly like a satisfied one.
///
/// 🏗️ MOVED HERE BY [ADR 067] decision 2. The brick keeps `_OfflineBanner`, a
/// `ConsumerWidget` that supplies the two things this package cannot see:
/// `networkUnreachableProvider` and the `ref.invalidate(appConfigProvider)` the
/// retry runs. Both are Riverpod.
///
/// 🔴 IT RETURNS THE CHILD UNTOUCHED WHEN REACHABLE, and that is deliberate
/// rather than incidental: inserting a `Column` above the router on every
/// launch would re-parent every screen in every stamped app in order to
/// display nothing. The tree is byte-identical to the pre-banner one until a
/// request has actually failed.
///
/// The retry re-runs the config resolution rather than "checking the network",
/// because the only honest test of reachability is the request the app wanted
/// to make in the first place — which is why [onRetry] is a callback and not a
/// connectivity probe this package could have run for itself.
class OfflineBannerHost extends StatelessWidget {
  const OfflineBannerHost({
    required this.unreachable,
    required this.onRetry,
    required this.child,
    super.key,
  });

  /// Whether the last config resolution failed to reach the network.
  final bool unreachable;

  /// Re-runs the request that failed. See the class doc for why this is not a
  /// connectivity check.
  final VoidCallback onRetry;

  /// The app below the banner.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!unreachable) return child;
    final ChassisLocalizations l10n = context.chassisL10n;
    return Column(
      children: <Widget>[
        OfflineNotice(
          message: l10n.offlineMessage,
          retryLabel: l10n.retry,
          onRetry: onRetry,
        ),
        Expanded(child: child),
      ],
    );
  }
}
