window.CsvWorkbench = window.CsvWorkbench || {};

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var W = 900;
  var H = 560;
  // Nice gridline positions on a log axis, as multipliers of a decade.
  var LOG_MULTIPLIERS = [1, 2, 3, 5];
  var LOG_EPS = 1e-9;
  // Approximate advance width of a digit at the 12px tick-label size, used to
  // reserve a left margin wide enough for the y labels.
  var TICK_CHAR_PX = 7;
  var MARKER_RADIUS = 5;

  // Marker shapes, in assignment order. Each is sized to roughly the area of a
  // circle of the same radius so no shape reads as heavier than the others.
  var SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'hexagon'];

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  // Regular n-gon inscribed in radius R, first vertex at startDeg.
  function polygonPoints(cx, cy, R, n, startDeg) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
      pts.push(cx + R * Math.cos(a) + ',' + (cy + R * Math.sin(a)));
    }
    return pts.join(' ');
  }

  // Radius multipliers chosen so each shape's area matches a circle of radius r.
  function markerNode(shape, cx, cy, r) {
    if (shape === 'square') {
      var s = r * 0.886;
      return el('rect', { x: cx - s, y: cy - s, width: 2 * s, height: 2 * s });
    }
    if (shape === 'triangle') {
      return el('polygon', { points: polygonPoints(cx, cy, r * 1.555, 3, -90) });
    }
    if (shape === 'triangleDown') {
      return el('polygon', { points: polygonPoints(cx, cy, r * 1.555, 3, 90) });
    }
    if (shape === 'diamond') {
      return el('polygon', { points: polygonPoints(cx, cy, r * 1.253, 4, -90) });
    }
    if (shape === 'hexagon') {
      return el('polygon', { points: polygonPoints(cx, cy, r * 1.0996, 6, -90) });
    }
    return el('circle', { cx: cx, cy: cy, r: r });
  }

  function extent(values) {
    var lo = Infinity;
    var hi = -Infinity;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    return { lo: lo, hi: hi };
  }

  /* ---------------- tick label formatting ---------------- */

  function formatLogTick(value) {
    if (value >= 1e-4 && value < 1e5) {
      var decimals = value >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(value) + LOG_EPS));
      return value.toFixed(decimals);
    }
    return value.toExponential(0).replace('e', 'e');
  }

  // Decimal places follow the tick step, so the same formatter works for volts,
  // resistances and raw counts alike.
  function makeLinearFormatter(step) {
    var mag = Math.floor(Math.log10(Math.abs(step)));
    if (!isFinite(mag) || mag < -6 || mag > 6) {
      return function (v) {
        return v === 0 ? '0' : v.toExponential(1);
      };
    }
    var decimals = Math.max(0, -mag);
    return function (v) {
      var s = v.toFixed(decimals);
      // toFixed can render a tiny negative tick as "-0.00".
      if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
      return s;
    };
  }

  /* ---------------- axis construction ---------------- */

  function logCandidates(lo, hi) {
    var out = [];
    var from = Math.floor(lo) - 1;
    var to = Math.ceil(hi) + 1;
    for (var k = from; k <= to; k++) {
      for (var m = 0; m < LOG_MULTIPLIERS.length; m++) {
        var mult = LOG_MULTIPLIERS[m];
        out.push({
          mult: mult,
          lg: k + Math.log10(mult),
          value: mult * Math.pow(10, k)
        });
      }
    }
    out.sort(function (a, b) {
      return a.lg - b.lg;
    });
    return out;
  }

  // Snapping to 1/2/3/5 gridlines rather than whole decades keeps a sub-decade
  // range from being padded out to a mostly empty axis.
  function buildLogAxis(lo, hi) {
    if (hi - lo < LOG_EPS) {
      lo -= 0.5;
      hi += 0.5;
    }
    var candidates = logCandidates(lo, hi);

    var min = candidates[0].lg;
    var max = candidates[candidates.length - 1].lg;
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].lg <= lo + LOG_EPS) min = candidates[i].lg;
      if (candidates[i].lg >= hi - LOG_EPS) {
        max = candidates[i].lg;
        break;
      }
    }
    if (max - min < LOG_EPS) {
      min -= 0.5;
      max += 0.5;
    }

    var inRange = candidates.filter(function (c) {
      return c.lg >= min - LOG_EPS && c.lg <= max + LOG_EPS;
    });
    var decades = inRange.filter(function (c) {
      return c.mult === 1;
    });

    // With fewer than two decades on screen there is nothing to read the scale
    // by, so the intermediate gridlines get labels too.
    var labelled = decades.length >= 2 ? decades : inRange;
    var labelledSet = new Set(
      labelled.map(function (c) {
        return c.lg;
      })
    );

    return {
      log: true,
      min: min,
      max: max,
      ticks: labelled.map(function (c) {
        return { v: c.lg, label: formatLogTick(c.value) };
      }),
      minor: inRange
        .filter(function (c) {
          return !labelledSet.has(c.lg);
        })
        .map(function (c) {
          return c.lg;
        })
    };
  }

  function niceLinearStep(span, targetCount) {
    var rough = span / (targetCount || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  }

  function buildLinearAxis(lo, hi) {
    var span = hi - lo;
    if (span <= 0) {
      var pad = Math.max(Math.abs(lo) * 0.05, 1);
      lo -= pad;
      hi += pad;
      span = hi - lo;
    } else {
      // A small pad first so a data point sitting exactly on a gridline still
      // gets breathing room after the snap below.
      lo -= span * 0.02;
      hi += span * 0.02;
      span = hi - lo;
    }

    var step = niceLinearStep(span, 5);
    var min = Math.floor(lo / step) * step;
    var max = Math.ceil(hi / step) * step;

    var format = makeLinearFormatter(step);
    var ticks = [];
    for (var t = min; t <= max + step * 1e-9; t += step) {
      // Re-round each tick: repeated addition drifts on values like 0.1.
      var v = Math.round(t / step) * step;
      ticks.push({ v: v, label: format(v) });
    }

    return { log: false, min: min, max: max, ticks: ticks, minor: [] };
  }

  function buildAxis(values, isLog) {
    var ex = extent(values);
    if (!ex) return null;
    return isLog ? buildLogAxis(ex.lo, ex.hi) : buildLinearAxis(ex.lo, ex.hi);
  }

  /* ---------------- rendering ---------------- */

  function axisTitle(axisConfig) {
    if (!axisConfig.column) return '';
    return axisConfig.log ? 'log10( ' + axisConfig.column + ' )' : axisConfig.column;
  }

  function renderChart(svg, visibleSeries, view) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // Scaling follows the points actually in play, so excluding an outlier
    // re-frames the plot around what remains. Excluded points are still drawn
    // (and stay clickable) but get clipped if they now fall outside.
    var xValues = [];
    var yValues = [];
    var xAll = [];
    var yAll = [];
    visibleSeries.forEach(function (s) {
      s.points.forEach(function (p) {
        xAll.push(p.x);
        yAll.push(p.y);
        if (!p.excluded) {
          xValues.push(p.x);
          yValues.push(p.y);
        }
      });
    });
    if (xValues.length === 0) {
      xValues = xAll;
      yValues = yAll;
    }

    var xAxis = buildAxis(xValues, view.axes.x.log);
    var yAxis = buildAxis(yValues, view.axes.y.log);

    if (!xAxis || !yAxis) {
      var empty = el('text', {
        x: W / 2,
        y: H / 2,
        'text-anchor': 'middle',
        class: 'chart-empty'
      });
      empty.textContent = view.emptyMessage || 'No series to display';
      svg.appendChild(empty);
      return;
    }

    var widestY = yAxis.ticks.reduce(function (n, t) {
      return Math.max(n, t.label.length);
    }, 1);
    var M = {
      top: 24,
      right: 28,
      bottom: 64,
      left: Math.min(160, Math.max(64, 34 + widestY * TICK_CHAR_PX))
    };
    var PW = W - M.left - M.right;
    var PH = H - M.top - M.bottom;

    var xOf = function (v) {
      return M.left + ((v - xAxis.min) / (xAxis.max - xAxis.min)) * PW;
    };
    var yOf = function (v) {
      return M.top + PH - ((v - yAxis.min) / (yAxis.max - yAxis.min)) * PH;
    };

    // Padded past the marker hit radius so a point sitting exactly on the axis
    // is still drawn whole and stays clickable; anything further out (an
    // excluded outlier after a rescale) is still clipped away.
    var clipPad = 14;
    var defs = el('defs');
    var clip = el('clipPath', { id: 'plot-clip' });
    clip.appendChild(
      el('rect', {
        x: M.left - clipPad,
        y: M.top - clipPad,
        width: PW + clipPad * 2,
        height: PH + clipPad * 2
      })
    );
    defs.appendChild(clip);
    svg.appendChild(defs);

    var gGrid = el('g', { class: 'grid' });
    var gAxis = el('g', { class: 'axis' });
    var gData = el('g', { 'clip-path': 'url(#plot-clip)' });
    var gHit = el('g', { 'clip-path': 'url(#plot-clip)' });
    svg.appendChild(gGrid);
    svg.appendChild(gAxis);
    svg.appendChild(gData);
    svg.appendChild(gHit);

    xAxis.minor.forEach(function (v) {
      var x = xOf(v);
      gGrid.appendChild(
        el('line', { x1: x, y1: M.top, x2: x, y2: M.top + PH, class: 'grid-minor' })
      );
    });
    yAxis.minor.forEach(function (v) {
      var y = yOf(v);
      gGrid.appendChild(
        el('line', { x1: M.left, y1: y, x2: M.left + PW, y2: y, class: 'grid-minor' })
      );
    });

    xAxis.ticks.forEach(function (t) {
      var x = xOf(t.v);
      gGrid.appendChild(
        el('line', { x1: x, y1: M.top, x2: x, y2: M.top + PH, class: 'grid-major' })
      );
      var label = el('text', {
        x: x,
        y: M.top + PH + 22,
        'text-anchor': 'middle',
        class: 'tick-label'
      });
      label.textContent = t.label;
      gAxis.appendChild(label);
    });

    yAxis.ticks.forEach(function (t) {
      var y = yOf(t.v);
      gGrid.appendChild(
        el('line', { x1: M.left, y1: y, x2: M.left + PW, y2: y, class: 'grid-major' })
      );
      var label = el('text', {
        x: M.left - 10,
        y: y + 4,
        'text-anchor': 'end',
        class: 'tick-label'
      });
      label.textContent = t.label;
      gAxis.appendChild(label);
    });

    gAxis.appendChild(
      el('rect', { x: M.left, y: M.top, width: PW, height: PH, class: 'plot-frame' })
    );

    var xTitle = el('text', {
      x: M.left + PW / 2,
      y: H - 16,
      'text-anchor': 'middle',
      class: 'axis-title'
    });
    xTitle.textContent = axisTitle(view.axes.x);
    gAxis.appendChild(xTitle);

    var yTitleX = 20;
    var yTitle = el('text', {
      x: yTitleX,
      y: M.top + PH / 2,
      'text-anchor': 'middle',
      transform: 'rotate(-90 ' + yTitleX + ' ' + (M.top + PH / 2) + ')',
      class: 'axis-title'
    });
    yTitle.textContent = axisTitle(view.axes.y);
    gAxis.appendChild(yTitle);

    /* ---- query guide ---- */

    var results = view.results || {};
    if (view.query !== null && view.query !== undefined && view.mode !== 'none') {
      var guide;
      if (view.direction === 'xToY') {
        var gx = xOf(view.query);
        guide = el('line', { x1: gx, y1: M.top, x2: gx, y2: M.top + PH });
      } else {
        var gy = yOf(view.query);
        guide = el('line', { x1: M.left, y1: gy, x2: M.left + PW, y2: gy });
      }
      guide.setAttribute('class', 'query-guide');
      gAxis.appendChild(guide);
    }

    /* ---- series ---- */

    visibleSeries.forEach(function (s) {
      // Colors come through as CSS custom-property references so light/dark
      // swap in one place; var() only resolves via style, not attributes.
      var color = s.color;
      var variant = s.variant;
      var interp = view.mode === 'interp';

      if (s.points.length >= 2) {
        var d = s.points
          .map(function (p, i) {
            return (i === 0 ? 'M' : 'L') + xOf(p.x) + ' ' + yOf(p.y);
          })
          .join(' ');
        var poly = el('path', {
          d: d,
          // In interpolation mode this polyline *is* the model, so it is drawn
          // as prominently as the fit line would be.
          'stroke-width': interp ? 2 : 1,
          'stroke-opacity': interp ? 0.9 : 0.45,
          'stroke-dasharray': variant.dash
        });
        poly.style.fill = 'none';
        poly.style.stroke = color;
        gData.appendChild(poly);
      }

      var result = results[s.id];
      var fit = result && result.fit;
      if (view.mode === 'fit' && fit && fit.ok) {
        var fitLine = el('line', {
          x1: xOf(fit.xMin),
          y1: yOf(fit.slope * fit.xMin + fit.intercept),
          x2: xOf(fit.xMax),
          y2: yOf(fit.slope * fit.xMax + fit.intercept),
          'stroke-width': 2,
          'stroke-dasharray': '8 4',
          'stroke-linecap': 'round'
        });
        fitLine.style.stroke = color;
        gData.appendChild(fitLine);
      }

      s.points.forEach(function (p, i) {
        var cx = xOf(p.x);
        var cy = yOf(p.y);
        var marker = markerNode(s.shape, cx, cy, MARKER_RADIUS);
        marker.setAttribute('class', 'point-marker');
        marker.setAttribute('stroke-width', 2);
        marker.setAttribute('opacity', p.excluded ? 0.55 : 1);
        marker.style.fill = p.excluded ? 'var(--surface)' : color;
        marker.style.stroke = color;
        gData.appendChild(marker);

        // The hit circle sits above the marker, so the tooltip must live here.
        var hit = el('circle', {
          cx: cx,
          cy: cy,
          r: 11,
          fill: 'transparent',
          class: 'point-hit'
        });
        var title = el('title');
        title.textContent =
          s.label +
          '\n' +
          view.axes.x.column +
          ' = ' +
          p.xRaw.toPrecision(6) +
          '\n' +
          view.axes.y.column +
          ' = ' +
          p.yRaw.toPrecision(6) +
          (p.excluded ? '\n(excluded — click to restore)' : '\n(click to exclude)');
        hit.appendChild(title);
        hit.dataset.seriesId = s.id;
        hit.dataset.pointIndex = String(i);
        gHit.appendChild(hit);
      });

      // Solution markers for the current query.
      var solved = result && result.solved;
      if (solved && solved.ok && view.query !== null && view.query !== undefined) {
        solved.values.forEach(function (val) {
          var sx = view.direction === 'xToY' ? xOf(view.query) : xOf(val);
          var sy = view.direction === 'xToY' ? yOf(val) : yOf(view.query);
          var ring = el('circle', {
            cx: sx,
            cy: sy,
            r: 7,
            'stroke-width': 2.5,
            class: 'solution-marker'
          });
          ring.style.fill = 'none';
          ring.style.stroke = color;
          gData.appendChild(ring);
        });
      }
    });
  }

  CsvWorkbench.chart = {
    MARKER_RADIUS: MARKER_RADIUS,
    SHAPES: SHAPES,
    markerNode: markerNode,
    renderChart: renderChart,
    buildAxis: buildAxis,
    buildLogAxis: buildLogAxis,
    buildLinearAxis: buildLinearAxis,
    makeLinearFormatter: makeLinearFormatter,
    formatLogTick: formatLogTick
  };
})();
