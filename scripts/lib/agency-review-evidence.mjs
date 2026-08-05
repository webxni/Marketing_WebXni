const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function snapshotContainsEvidence(snapshotText, evidenceId) {
  const value = String(evidenceId ?? '').trim().toLowerCase();
  return value.length >= 3 && snapshotText.includes(value);
}

export function normalizeEvidenceBackedReview(output, snapshot, reviewLabel = 'operational') {
  const snapshotText = JSON.stringify(snapshot ?? {}).toLowerCase();
  const findings = (Array.isArray(output?.findings) ? output.findings : [])
    .filter((finding) => finding && typeof finding === 'object')
    .filter((finding) => Array.isArray(finding.evidence_ids)
      && finding.evidence_ids.some((id) => snapshotContainsEvidence(snapshotText, id)))
    .map((finding) => ({
      ...finding,
      severity: finding.state === 'active' ? finding.severity : 'info',
    }));
  const activeFindings = findings.filter((finding) => finding.state === 'active');
  const severity = findings.reduce((worst, finding) => (
    (SEVERITY_RANK[finding.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0) ? finding.severity : worst
  ), 'info');

  if (activeFindings.length === 0) {
    return {
      ...output,
      severity: 'info',
      summary: `No active evidence-backed ${reviewLabel} issue was found. ${findings.length} recovered or historical observation(s) were retained for context.`,
      findings,
      recommended_actions: [],
      code_proposals: [],
      assignments: [],
    };
  }

  return { ...output, severity, findings };
}
