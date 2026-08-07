# Phiri Product Intelligence Layer (PPIL) v1

The Article B-roll Generator should emit product and rendering telemetry through PPIL, with PostHog behind an adapter.

Useful events include `broll.article_loaded`, `broll.passage_selected`, `broll.render_started`, `broll.render_completed`, `broll.render_failed`, `broll.export_completed`, and `ppil.error`.

Article text, PDF contents, filenames containing personal information, generated media contents, and filesystem paths are prohibited analytics payloads. Measure workflow metadata such as duration, passage length bucket, render duration, output format, application version, and error class instead.

Analytics is off until the user-facing notice/consent policy permits collection. Session replay is disabled by default for this desktop application.
