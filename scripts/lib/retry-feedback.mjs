export function buildRetryCorrection(feedback) {
  const message = String(feedback || '').toLowerCase();
  const corrections = [];

  if (message.includes('generic pattern')) {
    corrections.push('Replace generic urgency, checklist, and recycled title language with concrete service-specific wording.');
  }
  if (message.includes('restricted client content')) {
    corrections.push('Recheck CLIENT RESTRICTIONS and remove every prohibited service, phrase, and claim.');
  }
  if (message.includes('unsupported claim')) {
    corrections.push('Remove licensing, availability, timing, guarantee, credential, and performance claims unless the business brief explicitly verifies them.');
  }
  if (message.includes('phone mismatch')) {
    corrections.push('Use only the exact phone shown in BUSINESS CONTEXT, or omit the phone entirely.');
  }
  if (message.includes('target keyword already used') || message.includes('duplicates existing post')) {
    corrections.push('Follow the refreshed assigned topic and keyword exactly; do not reuse an earlier weekly angle.');
  }
  if (message.includes('quality validation failed')) {
    corrections.push('Run a final field-by-field quality check before returning the replacement JSON.');
  }
  if (corrections.length === 0) {
    corrections.push('Rebuild the complete draft from the refreshed brief and return valid JSON matching every schema requirement.');
  }

  return [...new Set(corrections)].map((item) => `- ${item}`).join('\n');
}
