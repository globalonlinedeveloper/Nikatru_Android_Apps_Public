import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/auth/check_inbox_screen.dart';

/// "Check your inbox" for a sessionless sign-up — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]), including
/// why this is not the same screen as `/verify-email`. All that is left here is
/// the navigation, which is the one thing a package declaring no go_router
/// cannot carry.
class CheckInboxScreen extends StatelessWidget {
  const CheckInboxScreen({required this.email, super.key});

  static const Key backToSignInButton = CheckInboxView.backToSignInButton;

  final String email;

  @override
  Widget build(BuildContext context) => CheckInboxView(
    email: email,
    onBackToSignIn: () => context.go('/sign-in'),
  );
}
