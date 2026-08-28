# Contributing

Issues and pull requests are welcome. Keep the core boundary intact: Ground Control may own Bluetooth and physiology; Flight Deck must remain Bluetooth/media-free and consume only the versioned command protocol.

Before a pull request:

```bash
npm ci
npm test
npm run test:browser
npm run build
```

Do not commit participant data, device identifiers, raw ECG recordings, Unity Asset Store files, or assets without a redistribution-compatible license. New metrics and wire fields require a schema/version decision plus tests and documentation.
