// One data-only policy is shared by the matcher, editor, and isolated page agent.
export const SAFETY_POLICY = Object.freeze({
  words: '\\b(password|passwd|passcode|cvv|cvc|ccv|ssn|otp|iban|pan|captcha|agree|agreement|consent|terms|certify|contraseña|passwort|senha)\\b',
  compact: 'password|passwd|passcode|creditcard|debitcard|paymentcard|cardnumber|cardholder|socialsecurity|onetimecode|verificationcode|securitycode|bankaccount|routingnumber|aadhaar|aadhar|passport|taxid|pannumber|pancard|ccnumber|ccname|ccexp|cccsc|cctype|ccgiven|ccfamily|ccadditional|expiry|expiration|privacypolicy|acceptterms|motdepasse|numerodecarte|numerodetarjeta|kartennummer|cartaodecredito|contraseña|पासवर्ड|आधार|ओटीपी',
  reviewLifetimeMs: 10 * 60 * 1000,
  maxNodes: 30000,
  maxControls: 2000,
  maxScanMs: 1500,
  maxFillMs: 12000,
  settleMs: 500
});

export function normalize(value = '') {
  return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function isSensitive(descriptor) {
  const values = [descriptor.type, descriptor.autocomplete, descriptor.context, ...(descriptor.signals || [])];
  const words = new RegExp(SAFETY_POLICY.words, 'u'), compact = new RegExp(SAFETY_POLICY.compact, 'u');
  return values.filter(Boolean).some(value => {
    const text = normalize(value);
    return words.test(text) || compact.test(text.replaceAll(' ', ''));
  });
}

export const sensitiveField = field => isSensitive({ signals: [field.label, ...(field.aliases || [])], autocomplete: field.autocomplete });
