/**
 * nleis.py's documented two-electrode TDS example.
 *
 * The 16 values are ordered as L0, R0, TDS0/TDSn0 (7 shared values), then
 * TDS1/TDSn1 (7 shared values). The nonlinear entries at indices 5 and 6 of
 * each TDS pair are only present in the 2nd-NLEIS circuit.
 */
export const DOCUMENTED_JOINT_TDS_TEMPLATE = {
  name: "Two-electrode TDS joint template",
  circuit1: "L0-R0-TDS0-TDS1",
  circuit2: "d(TDSn0,TDSn1)",
  initialGuess: [
    1e-7,
    1e-3,
    5e-3,
    1e-3,
    10,
    1e-2,
    100,
    10,
    0.1,
    1e-3,
    1e-3,
    1e-3,
    1e-2,
    1000,
    0,
    0,
  ],
} as const;
