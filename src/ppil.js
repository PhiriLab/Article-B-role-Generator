'use strict';

const FORBIDDEN = ['article', 'pdf_content', 'filename', 'filepath', 'path', 'text', 'content', 'prompt', 'response', 'email', 'name'];

class NoopBackend {
  capture() {}
}

class PPIL {
  constructor({ backend = new NoopBackend(), consent = false } = {}) {
    this.backend = backend;
    this.consent = consent;
  }

  setConsent(granted) {
    this.consent = Boolean(granted);
  }

  capture(name, properties = {}) {
    if (!this.consent || !PPIL.isValid(name, properties)) return false;
    this.backend.capture({ name, properties });
    return true;
  }

  static isValid(name, properties) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 80) return false;
    return Object.keys(properties).every((key) => {
      const lower = key.toLowerCase();
      return !FORBIDDEN.some((term) => lower.includes(term));
    });
  }
}

const events = {
  renderStarted: (passageLengthBucket, outputFormat) => ({
    name: 'broll.render_started', properties: { passage_length_bucket: passageLengthBucket, output_format: outputFormat }
  }),
  renderCompleted: (durationMs, outputFormat) => ({
    name: 'broll.render_completed', properties: { duration_ms: durationMs, output_format: outputFormat }
  }),
  renderFailed: (errorClass) => ({
    name: 'broll.render_failed', properties: { error_class: errorClass }
  })
};

module.exports = { PPIL, NoopBackend, events };
