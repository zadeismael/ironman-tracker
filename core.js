// Position + leg math shared by index.html and the Node tests. No DOM, no network.
// Course files (courses/<EVENT>.json) come from build_course.py.
(function (root) {
  const DEFAULT_MPH = { swim: 1.8, transition: 2.5, bike: 17, run: 5.5 };
  const MIN_MPH = { swim: 0.5, transition: 1, bike: 5, run: 2 };
  const MAX_MPH = { swim: 4, transition: 8, bike: 35, run: 14 };
  const PLAUSIBLE_MPH = { swim: 3.5, transition: 12, bike: 30, run: 11 };  // faster = bad mat read

  function createCore(course) {
    const mats = course.mats;
    const matByName = Object.fromEntries(mats.map(m => [m.name, m]));
    const r = course.route;
    const G = course.legs || { swim_end: 2.4, bike_start: 2.76, bike_end: 114.8, run_start: 114.96, finish: 141.041 };
    const FINISH_MI = G.finish;
    const segOf = mi => mi < G.swim_end ? "swim" : mi < G.bike_start ? "transition" : mi < G.bike_end ? "bike" : mi < G.run_start ? "transition" : "run";

    function pointAtMile(mi) {
      let lo = 0, hi = r.length - 1;
      if (!(mi > 0)) return [r[0][0], r[0][1]];
      if (mi >= r[hi][2]) return [r[hi][0], r[hi][1]];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; (r[m][2] < mi ? lo = m : hi = m); }
      const a = r[lo], b = r[hi], t = (mi - a[2]) / ((b[2] - a[2]) || 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }

    function mileOf(s) {
      if (!s) return null;
      const m = matByName[s.point];
      return m ? +m.miles : s.point === "START" ? 0 : s.point === "FINISH" ? FINISH_MI : null;
    }

    // Where is the athlete at nowSec? Exact at the last mat crossed, then extrapolated at her current
    // speed, never past the next mat (held just short of it until the mat confirms).
    // Drop mat reads that imply a superhuman speed since the last trusted read. On lapped courses RTRT
    // sometimes files a read under the wrong lap (seen in real 2025 data: "mile 9.8 of the run" 25 min
    // after T2). FINISH is always trusted.
    function trusted(rows) {
      const out = [];
      for (const s of rows) {
        const prev = out[out.length - 1];
        if (prev && s.point !== "FINISH") {
          const h = (+s.epochTime - +prev.epochTime) / 3600, d = mileOf(s) - mileOf(prev);
          if (h <= 0 || d / h > PLAUSIBLE_MPH[segOf(mileOf(s) - 0.001)]) continue;
        }
        out.push(s);
      }
      return out;
    }

    function estimate(splits, nowSec) {
      const known = trusted((splits || [])
        .filter(s => s && mileOf(s) !== null && isFinite(+s.epochTime) && +s.epochTime <= nowSec)
        .sort((a, b) => mileOf(a) - mileOf(b) || +a.epochTime - +b.epochTime));
      if (!known.length) return null;
      const last = known[known.length - 1], lastMi = mileOf(last);
      if (last.point === "FINISH") return { last, mile: FINISH_MI, finished: true, seen: known, lateBy: 0 };
      const next = mats.find(m => +m.miles > lastMi + 0.01) || null;
      const nextSeg = next ? next.segment : "run";
      // speed: her average over the last two mats of this sport, else RTRT's mph, else a default
      const sameSport = known.filter(s => segOf(mileOf(s) - 0.001) === nextSeg && mileOf(s) > 0);
      let mph = DEFAULT_MPH[nextSeg];
      if (sameSport.length >= 2) {
        const a = sameSport[sameSport.length - 2], b = sameSport[sameSport.length - 1];
        const h = (+b.epochTime - +a.epochTime) / 3600;
        if (h > 0) mph = (mileOf(b) - mileOf(a)) / h;
      } else if (sameSport.length === 1 && isFinite(+sameSport[0].mph) && +sameSport[0].mph > 0) {
        mph = +sameSport[0].mph;
      }
      mph = Math.min(Math.max(mph, MIN_MPH[nextSeg]), MAX_MPH[nextSeg]);   // timing glitches
      const since = Math.max(0, nowSec - +last.epochTime);
      const cap = next ? +next.miles - 0.05 : FINISH_MI - 0.05;
      let mile = Math.max(lastMi, lastMi + mph * since / 3600);
      const overdue = mile > cap;
      mile = Math.min(mile, Math.max(cap, lastMi));
      const etaNext = next ? +last.epochTime + ((+next.miles - lastMi) / mph) * 3600 : null;
      const lateBy = etaNext ? Math.max(0, nowSec - etaNext) : 0;
      return { last, mile, mph, next, nextSeg, etaNext, overdue, lateBy, since, finished: false, seen: known };
    }

    // Per-leg status for the Swim / Bike / Run cards. Course miles are scaled so the bike reads
    // 0–112 and the run 0–26.2 regardless of the exact surveyed course length.
    const LEGS = {
      swim: { from: 0, to: G.swim_end, official: 2.4, startPts: ["START"], endPts: ["SWIM"] },
      bike: { from: G.bike_start, to: G.bike_end, official: 112, startPts: ["T1", "SWIM", "START"], endPts: ["BIKE", "T2"] },
      run: { from: G.run_start, to: FINISH_MI, official: 26.2, startPts: ["T2", "BIKE"], endPts: ["FINISH"] },
    };
    function legs(splits, nowSec) {
      const st = estimate(splits, nowSec);
      const seen = st ? st.seen : [];
      const at = p => seen.find(s => s.point === p);
      const ep = s => +s.epochTime;
      const lastMi = st ? mileOf(st.last) : -1;
      const out = {};
      for (const [k, L] of Object.entries(LEGS)) {
        const scale = L.official / (L.to - L.from);
        const startS = L.startPts.map(at).find(Boolean);
        const endS = L.endPts.map(at).find(Boolean);
        if (endS || lastMi > L.to + 0.01) {       // a later mat implies this leg is done even if a mat missed her
          const secs = endS && startS && ep(endS) > ep(startS) ? ep(endS) - ep(startS) : null;
          out[k] = { state: "done", miles: L.official, secs, ...rates(k, L.official, secs, endS) };
          continue;
        }
        if (!st || !startS || lastMi < L.from - 0.45) { out[k] = { state: "pending" }; continue; }
        if (st.mile < L.from) { out[k] = { state: "transition" }; continue; }   // T1 / T2
        const miles = Math.max(0, Math.min(L.official, (st.mile - L.from) * scale));
        // average from mat-confirmed data only: last mat inside this leg vs. the leg start
        const lastIn = [...seen].reverse().find(s => { const m = mileOf(s); return m > L.from + 0.01 && m <= L.to + 0.01; });
        const confMi = lastIn ? (mileOf(lastIn) - L.from) * scale : 0;
        const confSecs = lastIn ? ep(lastIn) - ep(startS) : 0;
        out[k] = { state: "active", miles, since: nowSec - ep(startS), startedAt: ep(startS),
                   ...(confSecs > 0 && confMi > 0.4 ? rates(k, confMi, confSecs) : {}) };
      }
      return { st, legs: out };
    }
    function rates(k, miles, secs, endS) {
      if (k === "swim") {
        const p100 = secs ? secs / (miles * 1609.344 / 100) : null;
        return { pace100m: p100 || parsePace100(endS && endS.pace) };
      }
      if (!secs) return {};
      return k === "bike" ? { mph: miles / (secs / 3600) } : { minPerMile: secs / 60 / miles };
    }
    function parsePace100(p) { const m = /(\d+):(\d+)/.exec(p || ""); return m ? +m[1] * 60 + +m[2] : null; }

    return { mats, matByName, legsGeom: G, FINISH_MI, segOf, pointAtMile, mileOf, estimate, legs };
  }

  const api = { createCore, DEFAULT_MPH };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TrackerCore = api;
})(this);
