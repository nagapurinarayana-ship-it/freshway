const EXACT_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.opera.com',
  'push.services.opera.com'
]);

const PUSH_HOST_SUFFIXES = [
  '.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
  '.push.opera.com',
  '.push.services.opera.com'
];

function unsupportedEndpoint() {
  const error = new Error('Push endpoint is not a supported browser push service.');
  error.code = 'PUSH_ENDPOINT_UNSUPPORTED';
  return error;
}

/**
 * Accept only HTTPS endpoints belonging to known browser push services.
 * Subscription endpoints are untrusted client input; forwarding arbitrary
 * HTTPS URLs through web-push would turn notification delivery into an SSRF sink.
 */
export function validatePushEndpoint(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048) throw unsupportedEndpoint();

  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch (_) {
    throw unsupportedEndpoint();
  }

  if (endpoint.protocol !== 'https:' ||
      !endpoint.hostname ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      endpoint.hash) {
    throw unsupportedEndpoint();
  }

  const hostname = endpoint.hostname.toLowerCase();
  const supported = EXACT_PUSH_HOSTS.has(hostname) ||
    PUSH_HOST_SUFFIXES.some(suffix => hostname.length > suffix.length && hostname.endsWith(suffix));

  if (!supported) throw unsupportedEndpoint();
  return endpoint.toString();
}
