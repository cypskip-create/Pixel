/** Small synchronous probes used only while the main process composes diagnostics. */

export interface FileSystemCapacity {
  blocks: number;
  bavail: number;
  frsize: number;
}

/** Report capacity for the Pixel data volume without shelling out or enumerating other drives. */
export function probeVolumeCapacity(
  root: string,
  statfs: (path: string) => FileSystemCapacity,
): Array<{ mount: string; totalBytes: number | null; freeBytes: number | null }> {
  if (!root.trim()) throw new Error('The system volume path is unavailable.');
  const stats = statfs(root);
  if (![stats.blocks, stats.bavail, stats.frsize].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('The system volume returned invalid capacity values.');
  }
  const totalBytes = stats.blocks * stats.frsize;
  const freeBytes = stats.bavail * stats.frsize;
  if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(freeBytes) || freeBytes > totalBytes) {
    throw new Error('The system volume capacity exceeded the supported numeric range.');
  }
  return [{ mount: root, totalBytes, freeBytes }];
}
