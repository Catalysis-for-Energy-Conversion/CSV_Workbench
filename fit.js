window.CsvWorkbench = window.CsvWorkbench || {};

(function () {
  'use strict';

  var FLAT_SLOPE_EPS = 1e-12;
  // Two solutions closer than this (relative to the span) are the same node hit
  // from both of its segments.
  var DEDUPE_REL_EPS = 1e-9;

  function usedPoints(points) {
    return points.filter(function (p) {
      return !p.excluded;
    });
  }

  function bounds(points) {
    var b = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
    points.forEach(function (p) {
      if (p.x < b.xMin) b.xMin = p.x;
      if (p.x > b.xMax) b.xMax = p.x;
      if (p.y < b.yMin) b.yMin = p.y;
      if (p.y > b.yMax) b.yMax = p.y;
    });
    return b;
  }

  /* ---------------- least squares (in display space) ---------------- */

  function fitSeries(points) {
    var used = usedPoints(points);
    if (used.length < 2) {
      return { ok: false, reason: 'insufficient-data', n: used.length, total: points.length };
    }

    var n = used.length;
    var sumX = 0;
    var sumY = 0;
    for (var i = 0; i < n; i++) {
      sumX += used[i].x;
      sumY += used[i].y;
    }
    var meanX = sumX / n;
    var meanY = sumY / n;

    var sxx = 0;
    var syy = 0;
    var sxy = 0;
    for (var k = 0; k < n; k++) {
      var dx = used[k].x - meanX;
      var dy = used[k].y - meanY;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    if (sxx === 0) {
      return { ok: false, reason: 'degenerate', n: n, total: points.length };
    }

    var b = bounds(used);
    return {
      ok: true,
      slope: sxy / sxx,
      intercept: meanY - (sxy / sxx) * meanX,
      r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy),
      n: n,
      total: points.length,
      xMin: b.xMin,
      xMax: b.xMax,
      yMin: b.yMin,
      yMax: b.yMax
    };
  }

  // value and the returned values are both in display space; the caller applies
  // the log10 round-trip.
  function solveFit(fit, value, direction) {
    if (!fit.ok) return { ok: false, reason: fit.reason };

    if (direction === 'xToY') {
      return {
        ok: true,
        values: [fit.slope * value + fit.intercept],
        extrapolated: value < fit.xMin || value > fit.xMax
      };
    }

    if (Math.abs(fit.slope) < FLAT_SLOPE_EPS) {
      return { ok: false, reason: 'flat-slope' };
    }
    return {
      ok: true,
      values: [(value - fit.intercept) / fit.slope],
      extrapolated: value < fit.yMin || value > fit.yMax
    };
  }

  /* ---------------- piecewise linear interpolation ---------------- */

  function dedupe(values, span) {
    var eps = Math.abs(span) * DEDUPE_REL_EPS;
    var out = [];
    values.forEach(function (v) {
      var seen = out.some(function (u) {
        return Math.abs(u - v) <= eps;
      });
      if (!seen) out.push(v);
    });
    return out;
  }

  function segmentValue(p0, p1, value, from, to) {
    var d = p1[from] - p0[from];
    if (d === 0) return null;
    var t = (value - p0[from]) / d;
    return p0[to] + t * (p1[to] - p0[to]);
  }

  function interpolate(points, value, direction) {
    var used = usedPoints(points);
    if (used.length < 2) {
      return { ok: false, reason: 'insufficient-data', n: used.length };
    }

    var from = direction === 'xToY' ? 'x' : 'y';
    var to = direction === 'xToY' ? 'y' : 'x';

    // Segments follow the drawn polyline, which is ordered by x. Sorting by the
    // query axis instead would reconnect the points into a different curve and
    // lose crossings whenever the data is not monotonic in that axis.
    var path = used.slice().sort(function (a, b) {
      return a.x - b.x;
    });

    var hits = [];
    for (var i = 0; i < path.length - 1; i++) {
      var p0 = path[i];
      var p1 = path[i + 1];
      var lo = Math.min(p0[from], p1[from]);
      var hi = Math.max(p0[from], p1[from]);
      if (value < lo || value > hi) continue;
      var hit = segmentValue(p0, p1, value, from, to);
      if (hit !== null) hits.push(hit);
    }

    var b = bounds(used);
    var span = to === 'y' ? b.yMax - b.yMin : b.xMax - b.xMin;

    if (hits.length > 0) {
      return { ok: true, values: dedupe(hits, span || 1), extrapolated: false };
    }

    // Outside every segment: extend whichever end of the path starts closer to
    // the requested value, walking inward past segments flat in the query axis.
    var last = path.length - 1;
    var headFirst =
      Math.abs(value - path[0][from]) <= Math.abs(value - path[last][from]);

    var extrapolated = null;
    if (headFirst) {
      for (var a = 1; a <= last && extrapolated === null; a++) {
        extrapolated = segmentValue(path[0], path[a], value, from, to);
      }
    } else {
      for (var c = last - 1; c >= 0 && extrapolated === null; c--) {
        extrapolated = segmentValue(path[c], path[last], value, from, to);
      }
    }

    if (extrapolated === null) return { ok: false, reason: 'degenerate' };
    return { ok: true, values: [extrapolated], extrapolated: true };
  }

  function formatEquation(fit, xLabel, yLabel) {
    var sign = fit.intercept < 0 ? '−' : '+';
    return (
      yLabel +
      ' = ' +
      fit.slope.toPrecision(4) +
      '·' +
      xLabel +
      ' ' +
      sign +
      ' ' +
      Math.abs(fit.intercept).toPrecision(4)
    );
  }

  CsvWorkbench.fit = {
    FLAT_SLOPE_EPS: FLAT_SLOPE_EPS,
    fitSeries: fitSeries,
    solveFit: solveFit,
    interpolate: interpolate,
    formatEquation: formatEquation
  };
})();
