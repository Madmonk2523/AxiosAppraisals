/* Narrow content filter, not a replacement for CAPTCHA or server verification. */
(function (root) {
  'use strict';
  const phrases = Object.freeze([
    'USD waiting in your account',
    'AI research teams are licensing de-identified business data'
  ]);
  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  const hasBlockedContent = fields => Object.entries(fields).some(([key, value]) =>
    key !== 'token' && !key.startsWith('_') && typeof value === 'string' &&
    phrases.some(phrase => normalize(value).includes(normalize(phrase))));
  const policy = Object.freeze({ phrases, hasBlockedContent });
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.AxiosContactPolicy = policy;
})(typeof window === 'undefined' ? globalThis : window);
