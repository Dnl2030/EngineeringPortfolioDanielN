/*
 * Physics used by the Formula SAE interactive figures. Plain script (no modules) so the site also works
 * when opened directly from disk. Exposes window.Physics.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------------------------------
   * 2. Formula SAE 20 mm intake restrictor: isentropic choked-flow ceiling vs engine demand.
   *   ṁ* = Cd·A·p0·sqrt(γ/(R·T0))·(2/(γ+1))^((γ+1)/(2(γ−1)))
   *   ṁ  = VE·ρ0·Vd·N/120   (four-stroke)
   * ---------------------------------------------------------------------------------------- */
  var GAMMA = 1.4, R_AIR = 287.05;
  var STD = { p0: 101325, T0: 298.15 };

  function chokedMassFlow(dM, amb, cd) {
    amb = amb || STD; cd = cd == null ? 1 : cd;
    var A = (Math.PI * dM * dM) / 4, g = GAMMA;
    return cd * A * amb.p0 * Math.sqrt(g / (R_AIR * amb.T0)) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  }
  function airDemand(rpm, vdM3, ve, amb) {
    amb = amb || STD;
    return (ve * (amb.p0 / (R_AIR * amb.T0)) * vdM3 * rpm) / 120;
  }
  function crossoverRpm(dM, vdM3, ve, amb, cd) {
    amb = amb || STD;
    return (chokedMassFlow(dM, amb, cd) * 120) / (ve * (amb.p0 / (R_AIR * amb.T0)) * vdM3);
  }

  /* ------------------------------------------------------------------------------------------
   * 3. Normalized cam rise laws. u ∈ [0,1] → [lift, velocity, acceleration, jerk] (d/du).
   * ---------------------------------------------------------------------------------------- */
  var PI = Math.PI;
  var LAWS = [
    {
      id: "harmonic", label: "Simple harmonic",
      note: "Smooth lift, but acceleration jumps at the start of the rise, so jerk is unbounded at the transition.",
      fn: function (u) {
        return [(1 - Math.cos(PI * u)) / 2, (PI / 2) * Math.sin(PI * u), ((PI * PI) / 2) * Math.cos(PI * u), -((PI * PI * PI) / 2) * Math.sin(PI * u)];
      }
    },
    {
      id: "p345", label: "3-4-5 polynomial",
      note: "Zero velocity and acceleration at both ends of the rise: steeper flanks and a fuller nose than harmonic motion, with finite jerk.",
      fn: function (u) {
        var u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
        return [10 * u3 - 15 * u4 + 6 * u5, 30 * u2 - 60 * u3 + 30 * u4, 60 * u - 180 * u2 + 120 * u3, 60 - 360 * u + 360 * u2];
      }
    },
    {
      id: "p4567", label: "4-5-6-7 polynomial",
      note: "Also brings jerk to zero at the ends, at the cost of higher peak velocity and acceleration.",
      fn: function (u) {
        var p = function (n) { return Math.pow(u, n); };
        return [35 * p(4) - 84 * p(5) + 70 * p(6) - 20 * p(7), 140 * p(3) - 420 * p(4) + 420 * p(5) - 140 * p(6),
          420 * p(2) - 1680 * p(3) + 2100 * p(4) - 840 * p(5), 840 * u - 5040 * p(2) + 8400 * p(3) - 4200 * p(4)];
      }
    },
    {
      id: "p56789", label: "5-6-7-8-9 polynomial",
      note: "Continuous through the fourth derivative: the smoothest ends, but the largest velocity, acceleration and jerk peaks mid-rise.",
      fn: function (u) {
        var p = function (n) { return Math.pow(u, n); };
        return [126 * p(5) - 420 * p(6) + 540 * p(7) - 315 * p(8) + 70 * p(9),
          630 * p(4) - 2520 * p(5) + 3780 * p(6) - 2520 * p(7) + 630 * p(8),
          2520 * p(3) - 12600 * p(4) + 22680 * p(5) - 17640 * p(6) + 5040 * p(7),
          7560 * p(2) - 50400 * p(3) + 113400 * p(4) - 105840 * p(5) + 35280 * p(6)];
      }
    }
  ];

  /** Symmetric event: rise over x ∈ [0, .5], mirrored return over [.5, 1]; derivatives d/dx. */
  function eventKinematics(law, x) {
    var k;
    if (x <= 0.5) { k = law.fn(x * 2); return [k[0], k[1] * 2, k[2] * 4, k[3] * 8]; }
    k = law.fn((1 - x) * 2);
    return [k[0], -k[1] * 2, k[2] * 4, -k[3] * 8];
  }
  function fractionAbove(law, threshold) {
    var n = 0, N = 4000;
    for (var i = 0; i <= N; i++) if (eventKinematics(law, i / N)[0] >= threshold) n++;
    return n / (N + 1);
  }
  function peaks(law) {
    var v = 0, a = 0, j = 0;
    for (var i = 0; i <= 4000; i++) {
      var k = law.fn(i / 4000);
      v = Math.max(v, Math.abs(k[1])); a = Math.max(a, Math.abs(k[2])); j = Math.max(j, Math.abs(k[3]));
    }
    return { v: v, a: a, j: j };
  }

  window.Physics = {
    restrictor: { chokedMassFlow: chokedMassFlow, airDemand: airDemand, crossoverRpm: crossoverRpm, STD: STD },
    cams: { LAWS: LAWS, eventKinematics: eventKinematics, fractionAbove: fractionAbove, peaks: peaks }
  };
})();
