export type LocalNetworkSettingsCandidate = {
  bindIp: string;
  broadcastSubnetMask: string;
  source: string;
  interfaceName: string;
};

export function localNetworkCandidateKey(candidate: LocalNetworkSettingsCandidate): string {
  return `${candidate.bindIp.trim()}::${candidate.broadcastSubnetMask.trim()}::${candidate.interfaceName.trim()}`;
}
