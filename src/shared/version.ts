const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function isVersion(v: string): boolean {
  return SEMVER.test(v);
}

function parse(v: string): [number, number, number] {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`Not a version (X.Y.Z): ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative, zero or positive like a comparator; only plain X.Y.Z versions. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
