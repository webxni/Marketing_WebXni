const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function snapshotContainsEvidence(snapshotText, evidenceId) {
  const value = String(evidenceId ?? '').trim().toLowerCase();
  return value.length >= 3 && snapshotText.includes(value);
}

export function normalizeEvidenceBackedReview(output, snapshot, reviewLabel = 'operational') {
  const evidenceSnapshot = {
    generated_at: snapshot?.generated_at,
    overview: snapshot?.overview,
    system_health: snapshot?.system_health,
    approved_jobs: snapshot?.approved_jobs,
    backend_health: snapshot?.backend_health,
    agents: snapshot?.agents,
    coverage: snapshot?.coverage,
  };
  const snapshotText = JSON.stringify(evidenceSnapshot).toLowerCase();
  const terminalIncidentIds = new Set(
    (snapshot?.system_health?.recent_generation_failures ?? [])
      .map((run) => String(run?.id ?? '').toLowerCase())
      .filter(Boolean),
  );
  const findings = (Array.isArray(output?.findings) ? output.findings : [])
    .filter((finding) => finding && typeof finding === 'object')
    .filter((finding) => Array.isArray(finding.evidence_ids)
      && finding.evidence_ids.some((id) => snapshotContainsEvidence(snapshotText, id)))
    .map((finding) => {
      const evidenceIds = finding.evidence_ids.map((id) => String(id).toLowerCase());
      const terminalIncidentOnly = evidenceIds.length > 0 && evidenceIds.every((id) => terminalIncidentIds.has(id));
      const state = terminalIncidentOnly ? 'historical' : finding.state;
      return { ...finding, state, severity: state === 'active' ? finding.severity : 'info' };
    });
  const actionableActiveFindings = findings.filter((finding) => (
    finding.state === 'active' && (SEVERITY_RANK[finding.severity] ?? 0) > SEVERITY_RANK.info
  ));
  const severity = findings.reduce((worst, finding) => (
    (SEVERITY_RANK[finding.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0) ? finding.severity : worst
  ), 'info');

  if (actionableActiveFindings.length === 0) {
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

export function shouldPersistAgentFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  if (!finding.state) return true;
  return finding.state === 'active' && (SEVERITY_RANK[finding.severity] ?? 0) > SEVERITY_RANK.info;
}
