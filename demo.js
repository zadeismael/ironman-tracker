// Demo mode (?demo=swim etc.): a made-up race for Mikaela on the real course, paced to her
// projections, so the page can be checked on a phone before race day. Loaded only in demo mode.
(function (root) {
  const MOMENTS = ["prerace", "swim", "t1", "bike", "t2", "run", "finish"];
  function build(course, moment, proj) {
    const G = course.legs, T = 300;
    const START = 1792332600;                         // Sun Oct 18 2026, 7:10 am PDT
    const S = proj.swim, B = proj.bike, R = proj.run;
    const crossing = mi => mi <= G.swim_end ? mi / G.swim_end * S
      : mi <= G.bike_start ? S + T
      : mi <= G.bike_end ? S + T + (mi - G.bike_start) / (G.bike_end - G.bike_start) * B
      : mi <= G.run_start ? S + T + B + T
      : S + 2 * T + B + (mi - G.run_start) / (G.finish - G.run_start) * R;
    const hms = s => [s / 3600, s % 3600 / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, "0")).join(":") + ".00";
    const tod = e => new Date(e * 1000).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase();
    const total = crossing(G.finish);
    const row = (point, label, mi, x = {}) => { const t = crossing(mi), e = START + t;
      return { point, label, epochTime: String(e), timeOfDay: tod(e), netTime: hms(t), etfp: `FINISH~${hms(total)}~${tod(START + total).replace(/:\d\d (am|pm)/, " $1")}`, ...x }; };
    const splits = [row("START", "Race Start", 0)];
    for (const m of course.mats) splits.push(row(m.name, m.label, +m.miles, m.segment === "bike" ? { mph: (112 / (B / 3600)).toFixed(2) } : {}));
    splits.push(row("FINISH", "Race Finish", G.finish));
    const at = p => +splits.find(s => s.point === p).epochTime;
    const now = { prerace: START - 20 * 60, swim: START + 25 * 60, t1: at("SWIM") + 60, bike: at("BIKE10") + 600,
                  t2: at("BIKE") + 60, run: at("RUN5") + 480, finish: at("FINISH") + 300 }[moment] || START + 25 * 60;
    return { splits, now };
  }
  root.TrackerDemo = { build, MOMENTS };
})(this);
