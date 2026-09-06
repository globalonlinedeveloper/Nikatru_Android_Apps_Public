import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/auth/reset_password_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';

/// Where a password-reset link lands — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]). Everything
/// this file still owns is the part a package that declares no Riverpod and no
/// go_router cannot have: the provider reads, the seam call and the navigation.
/// Why the screen is written twice at all is answered in `ResetPasswordView`'s
/// own header, which travelled with the body.
class ResetPasswordScreen extends ConsumerWidget {
  const ResetPasswordScreen({super.key});

  // The key constants stay spelled HERE and are aliases of the package's, not
  // copies: the tests reach them through this class name, and two `Key('…')`
  // literals in two files is the drift the chassis exists to remove.
  static const Key passwordField = ResetPasswordView.passwordField;
  static const Key confirmField = ResetPasswordView.confirmField;
  static const Key submitButton = ResetPasswordView.submitButton;
  static const Key signInButton = ResetPasswordView.signInButton;
  static const Key statusLine = ResetPasswordView.statusLine;
  static const Key doneLine = ResetPasswordView.doneLine;
  static const Key linkDeadLine = ResetPasswordView.linkDeadLine;
  static const Key linkDeadHint = ResetPasswordView.linkDeadHint;

  /// The single exit, from both terminal states.
  ///
  /// 🔴 THE SIGN-OUT IS WHAT RELEASES THE GATE, and it is why this stayed in
  /// the adapter. `passwordRecoveryProvider` clears on `AuthEventKind.signedOut`
  /// and on nothing else, so a version that only navigated would leave the gate
  /// armed and the router would put the user straight back here.
  ///
  /// 🔴 THE ARRIVAL IS CLEARED BEFORE THE AWAIT, AND CLEARED AT ALL.
  /// `signedOut` is deliberately NOT a release for the arrival — see
  /// `passwordResetArrivalProvider` — so this is the ONE release, and without it
  /// a dead link would hold the user here for the rest of the session. Before
  /// the await because the sign-out tears this element down.
  ///
  /// 🔴 THE SPINE, NOT `auth.signOut()`. `assert-seams-wired` caught that: a
  /// session-ending control beside the spine leaves the entitlement cache —
  /// honoured offline for up to seven days — and the notification schedule
  /// belonging to the person who just left. It matters MORE here than anywhere,
  /// because a password reset's likeliest cause is "somebody else had my
  /// account" and the device that finishes it may not be the owner's.
  Future<void> _leave(BuildContext context, WidgetRef ref) async {
    ref.read(passwordResetArrivalProvider.notifier).clear();
    try {
      await signOutAndForgetUser(ref);
    } catch (_) {
      // A sign-out that failed must not trap the user on this page. The gate
      // reads a session that is still there; navigating is still correct.
    }
    if (context.mounted) context.go('/sign-in');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    final core.PasswordResetArrivalReport arrival = ref.watch(
      passwordResetArrivalProvider,
    );
    return ResetPasswordView(
      hasSession: auth.currentUser != null,
      recovering: ref.watch(passwordRecoveryProvider),
      arrival: arrival.arrival,
      problem: arrival.problem,
      onSubmit: (String newPassword) =>
          auth.updatePassword(newPassword: newPassword),
      onLeave: () => _leave(context, ref),
    );
  }
}
