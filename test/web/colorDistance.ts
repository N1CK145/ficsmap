// Colour distance for the theme tests: CIEDE2000 (ΔE00) in CIELAB (D65), and a colour-vision-deficiency simulation
// (Machado et al. 2009, severity 1) to check that two colours stay apart for protan and deutan viewers too.
// As a rule of thumb ΔE00 ≥ 10 reads as clearly different at a glance.

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

function lab(c: string): [number, number, number] {
  const [r, g, b] = hex(c).map(toLinear) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 colour difference of two `#rrggbb` colours. */
export function deltaE(c1: string, c2: string): number {
  const [l1, a1, b1] = lab(c1);
  const [l2, a2, b2] = lab(c2);
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1 = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2 = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  let dh = h2 - h1;
  if (c1p * c2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = l2 - l1;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dh / 2));
  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  const hBar = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 + 360) / 2;
  const t =
    1 - 0.17 * Math.cos(rad(hBar - 30)) + 0.24 * Math.cos(rad(2 * hBar)) + 0.32 * Math.cos(rad(3 * hBar + 6)) - 0.2 * Math.cos(rad(4 * hBar - 63));
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(rad(2 * dTheta)) * rC;
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
}

const CVD = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

/** How a `#rrggbb` colour looks to a viewer with protanopia or deuteranopia. */
export function simulate(c: string, kind: keyof typeof CVD): string {
  const v = hex(c).map(toLinear);
  const out = CVD[kind].map(row => Math.min(1, Math.max(0, row[0] * v[0]! + row[1] * v[1]! + row[2] * v[2]!)));
  return `#${out.map(x => fromLinear(x).toString(16).padStart(2, '0')).join('')}`;
}

/** The smallest ΔE00 of two colours over normal, protan and deutan vision. */
export function minDeltaE(c1: string, c2: string): number {
  return Math.min(
    deltaE(c1, c2),
    deltaE(simulate(c1, 'protan'), simulate(c2, 'protan')),
    deltaE(simulate(c1, 'deutan'), simulate(c2, 'deutan')),
  );
}
