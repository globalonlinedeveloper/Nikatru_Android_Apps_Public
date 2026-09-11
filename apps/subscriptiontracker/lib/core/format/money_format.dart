// MoneyFormatter lives in nikatru_core: packages/core/lib/src/money/money_format.dart.
// This file is only the import path the screens already use, and it is
// byte-identical in the app and in the brick. Do NOT declare a MoneyFormatter
// here — the export below would collide with it, so a copy cannot come back
// quietly (tooling/ci/test/no-seam-forks.test.mjs also refuses one).
export 'package:nikatru_core/nikatru_core.dart'
    show Money, MoneyBag, MoneyFormatter;
