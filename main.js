(function () {
  'use strict';

  var S = CsvWorkbench.series;
  var F = CsvWorkbench.fit;
  var C = CsvWorkbench.chart;
  var P = CsvWorkbench.csv;

  // Significant figures: slopes at 4, computed values at 5.
  var SIG_SLOPE = 4;
  var SIG_VALUE = 5;
  var NO_GROUP = ' none';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var store = S.createStore();

  var svg = document.getElementById('chart');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var overlay = document.getElementById('drag-overlay');
  var fileList = document.getElementById('file-list');
  var resultCards = document.getElementById('result-cards');
  var calcForm = document.getElementById('calc-form');
  var calcBlock = document.getElementById('calc-block');
  var calcLabel = document.getElementById('calc-label');
  var qInput = document.getElementById('q-input');
  var showAllBtn = document.getElementById('show-all');
  var clearAllBtn = document.getElementById('clear-all');
  var exportBtn = document.getElementById('export-csv');
  var exportDialog = document.getElementById('export-dialog');
  var exportColumns = document.getElementById('export-columns');
  var exportNote = document.getElementById('export-note');
  var exportConfirm = document.getElementById('export-confirm');
  var exportCancel = document.getElementById('export-cancel');
  var exportAllCols = document.getElementById('export-all-cols');
  var exportNoCols = document.getElementById('export-no-cols');
  var analysisExportRow = document.getElementById('analysis-export-row');
  var exportAnalysisBtn = document.getElementById('export-analysis');
  var swapBtn = document.getElementById('swap-axes');

  var panelAxes = document.getElementById('panel-axes');
  var xColumnSel = document.getElementById('x-column');
  var yColumnSel = document.getElementById('y-column');
  var groupColumnSel = document.getElementById('group-column');
  var groupColumn2Sel = document.getElementById('group-column-2');
  var xLogChk = document.getElementById('x-log');
  var yLogChk = document.getElementById('y-log');

  var axesSummary = document.getElementById('axes-summary');
  var filesSummary = document.getElementById('files-summary');
  var analysisSummary = document.getElementById('analysis-summary');

  var axesPanelAutoOpened = false;
  // Series lists are open by default; this records the ones the user closed, so
  // the choice survives the file-list re-render that recreates the <details>.
  var collapsedSeriesLists = new Set();
  // Which member of an overlapping cluster the next click should toggle.
  var overlapPick = { key: null, index: 0 };

  /* ---------------- helpers ---------------- */

  var toDisplay = S.toDisplay;
  var fromDisplay = S.fromDisplay;

  function formatNum(v, sig) {
    if (typeof v !== 'number' || isNaN(v)) return 'NaN';
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    if (v === 0) return '0';
    var abs = Math.abs(v);
    if (abs >= 1e-4 && abs < 1e6) return v.toPrecision(sig);
    return v.toExponential(sig - 1);
  }

  function colorVar(fileEntry) {
    // Hue identifies the file; lightness and chroma come from the theme.
    return (
      'oklch(var(--series-l) var(--series-c) ' +
      S.fileVariant(store, fileEntry).hue +
      ')'
    );
  }

  // Series within a file share the file's hue and differ only in how far they
  // are mixed toward the surface, giving a pale-to-deep ramp across the group.
  function seriesColor(fileEntry, series) {
    var shade = S.seriesVariant(series).shade;
    if (shade >= 99.5) return colorVar(fileEntry);
    return (
      'color-mix(in srgb, ' + colorVar(fileEntry) + ' ' + shade + '%, var(--surface))'
    );
  }

  function seriesLabel(fileEntry, series) {
    return series.groupLabel
      ? fileEntry.label + ' · ' + series.groupLabel
      : fileEntry.label;
  }

  // Shape is a file-level channel: every group of a file shares it.
  function seriesShape(series) {
    var fileEntry = store.files.get(series.fileId);
    if (!fileEntry) return C.SHAPES[0];
    return C.SHAPES[S.fileVariant(store, fileEntry).shapeIndex % C.SHAPES.length];
  }

  // Series decorated with the presentation data the chart and legend share.
  function viewSeries(series) {
    var fileEntry = store.files.get(series.fileId);
    var decorated = Object.create(series);
    decorated.color = seriesColor(fileEntry, series);
    decorated.variant = S.seriesVariant(series);
    decorated.shape = seriesShape(series);
    decorated.label = seriesLabel(fileEntry, series);
    return decorated;
  }

  // Legend key drawn with the same geometry the chart uses, so shape and shade
  // can be matched by eye between the list and the plot.
  function legendMarker(color, shape) {
    var node = document.createElementNS(SVG_NS, 'svg');
    node.setAttribute('class', 'series-key');
    node.setAttribute('viewBox', '0 0 26 14');
    node.setAttribute('aria-hidden', 'true');

    var line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', 1);
    line.setAttribute('y1', 7);
    line.setAttribute('x2', 25);
    line.setAttribute('y2', 7);
    line.setAttribute('stroke-width', 2);
    line.setAttribute('stroke-dasharray', '6 3');
    line.style.stroke = color;
    node.appendChild(line);

    var marker = C.markerNode(shape, 13, 7, 4.5);
    marker.setAttribute('stroke-width', 1.5);
    marker.style.fill = color;
    marker.style.stroke = color;
    node.appendChild(marker);
    return node;
  }

  // Marker on its own, for the file and result-card headings. Shape carries the
  // file identity just as much as hue does, so a fixed square here would leave
  // the heading disagreeing with the plot from the seventh file onward.
  function shapeSwatch(color, shape) {
    var node = document.createElementNS(SVG_NS, 'svg');
    node.setAttribute('class', 'swatch');
    node.setAttribute('viewBox', '0 0 14 14');
    node.setAttribute('aria-hidden', 'true');
    // 4.5 is the largest radius whose triangle still fits the 14×14 box; at 5
    // the apex pokes out and can touch the label beside it.
    var marker = C.markerNode(shape, 7, 7, 4.5);
    marker.setAttribute('stroke-width', 1.5);
    marker.style.fill = color;
    marker.style.stroke = color;
    node.appendChild(marker);
    return node;
  }

  function axisLabel(axisConfig) {
    if (!axisConfig.column) return '—';
    return axisConfig.log ? 'log10(' + axisConfig.column + ')' : axisConfig.column;
  }

  // The async clipboard API is only handed out in a secure context, and not
  // every browser counts file:// as one — Safari does not. Falling back to the
  // old selection-based copy keeps the button working when opened from disk.
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          // Rejected for want of focus or permission; the old path may still work.
          return legacyCopy(text);
        }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* ---------------- analysis ---------------- */

  function computeAnalysis() {
    var mode = store.analysis.mode;
    var dir = store.analysis.direction;
    var fromAxis = dir === 'xToY' ? store.axes.x : store.axes.y;
    var toAxis = dir === 'xToY' ? store.axes.y : store.axes.x;

    var qRaw = store.analysis.query;
    var qDisplay = null;
    var qError = null;
    if (qRaw !== null && mode !== 'none') {
      if (fromAxis.log && qRaw <= 0) {
        qError = 'Values ≤ 0 cannot be used on a log10 axis';
      } else {
        qDisplay = toDisplay(qRaw, fromAxis.log);
      }
    }

    var results = {};
    store.series.forEach(function (s, id) {
      var entry = { fit: null, solved: null };
      if (mode === 'fit') {
        entry.fit = F.fitSeries(s.points);
        if (qDisplay !== null && entry.fit.ok) {
          entry.solved = F.solveFit(entry.fit, qDisplay, dir);
        }
      } else if (mode === 'interp' && qDisplay !== null) {
        entry.solved = F.interpolate(s.points, qDisplay, dir);
      }
      results[id] = entry;
    });

    return {
      mode: mode,
      direction: dir,
      fromAxis: fromAxis,
      toAxis: toAxis,
      qDisplay: qDisplay,
      qError: qError,
      results: results
    };
  }

  /* ---------------- render ---------------- */

  function render() {
    var analysis = computeAnalysis();
    var visible = S.getVisibleSeries(store).map(viewSeries);

    C.renderChart(svg, visible, {
      axes: store.axes,
      mode: analysis.mode,
      direction: analysis.direction,
      query: analysis.qDisplay,
      results: analysis.results,
      emptyMessage:
        store.files.size === 0 ? 'Drop a CSV to begin' : 'No series to display'
    });

    renderFileList(analysis);
    renderResults(visible, analysis);
    renderSummaries(visible, analysis);
    exportBtn.disabled = visible.length === 0;
    exportAnalysisBtn.disabled = visible.length === 0;
  }

  function rebuildAndRender() {
    S.rebuildAllSeries(store);
    syncAxisControls();
    // The solve field is labelled with the axis column, so it goes stale the
    // moment the axes change — and a stale label misreports which column the
    // number being typed belongs to.
    syncCalcControls();
    render();
  }

  function renderSummaries(visible, analysis) {
    axesSummary.textContent = store.axes.x.column
      ? 'X: ' + axisLabel(store.axes.x) + '  |  Y: ' + axisLabel(store.axes.y)
      : 'Not set';

    var total = 0;
    store.series.forEach(function () {
      total++;
    });
    filesSummary.textContent =
      store.files.size === 0
        ? 'No files'
        : store.files.size +
          (store.files.size === 1 ? ' file · ' : ' files · ') +
          visible.length +
          '/' +
          total +
          ' series shown';

    var modeText =
      analysis.mode === 'fit'
        ? 'Linear fit'
        : analysis.mode === 'interp'
        ? 'Linear interpolation'
        : 'None';
    analysisSummary.textContent =
      analysis.mode === 'none'
        ? modeText
        : modeText + ' · ' + (analysis.direction === 'xToY' ? 'X→Y' : 'Y→X');
  }

  /* ---------------- axis controls ---------------- */

  function fillSelect(select, options, selected, placeholder) {
    select.textContent = '';
    if (placeholder) {
      var opt = document.createElement('option');
      opt.value = NO_GROUP;
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    options.forEach(function (name) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      select.appendChild(o);
    });
    select.value = selected === null ? NO_GROUP : selected;
    // A column selected earlier can vanish when its file is removed.
    if (select.value === '' && select.options.length > 0) {
      select.selectedIndex = 0;
    }
  }

  function syncAxisControls() {
    var nums = S.numericColumns(store);
    var all = S.allColumns(store);
    var enabled = store.files.size > 0 && nums.length > 0;

    fillSelect(xColumnSel, nums, store.axes.x.column, null);
    fillSelect(yColumnSel, nums, store.axes.y.column, null);
    fillSelect(groupColumnSel, all, store.groupColumns[0], '(no grouping)');
    fillSelect(groupColumn2Sel, all, store.groupColumns[1], '(none)');

    xColumnSel.disabled = !enabled;
    yColumnSel.disabled = !enabled;
    groupColumnSel.disabled = !enabled;
    // A second grouping level is meaningless until a first one is chosen.
    groupColumn2Sel.disabled = !enabled || store.groupColumns[0] === null;
    xLogChk.disabled = !enabled;
    yLogChk.disabled = !enabled;
    swapBtn.disabled = !enabled;

    xLogChk.checked = store.axes.x.log;
    yLogChk.checked = store.axes.y.log;
  }

  function onAxisChange() {
    store.axes.x.column = xColumnSel.value;
    store.axes.y.column = yColumnSel.value;
    store.axes.x.log = xLogChk.checked;
    store.axes.y.log = yLogChk.checked;
    store.groupColumns = [
      groupColumnSel.value === NO_GROUP ? null : groupColumnSel.value,
      groupColumn2Sel.value === NO_GROUP ? null : groupColumn2Sel.value
    ];
    if (store.groupColumns[0] === null) store.groupColumns[1] = null;
    rebuildAndRender();
  }

  [xColumnSel, yColumnSel, groupColumnSel, groupColumn2Sel, xLogChk, yLogChk].forEach(
    function (node) {
      node.addEventListener('change', onAxisChange);
    }
  );

  swapBtn.addEventListener('click', function () {
    var x = store.axes.x;
    store.axes.x = store.axes.y;
    store.axes.y = x;
    rebuildAndRender();
  });

  /* ---------------- file list / legend ---------------- */

  function renderFileList(analysis) {
    fileList.textContent = '';
    var files = S.orderedFiles(store);
    if (files.length === 0) {
      var p = document.createElement('p');
      p.className = 'placeholder';
      p.textContent = 'No files loaded yet.';
      fileList.appendChild(p);
      return;
    }

    files.forEach(function (entry) {
      var group = document.createElement('div');
      group.className = 'file-group';

      var head = document.createElement('div');
      head.className = 'file-head';

      if (!entry.error) {
        head.appendChild(
          shapeSwatch(
            colorVar(entry),
            C.SHAPES[S.fileVariant(store, entry).shapeIndex % C.SHAPES.length]
          )
        );
      }

      var label = document.createElement('input');
      label.type = 'text';
      label.className = 'file-label';
      label.value = entry.label;
      label.title = entry.rawName;
      // Only the result cards are redrawn: a full render() would recreate this
      // input and drop focus mid-typing.
      label.addEventListener('input', function () {
        entry.label = label.value;
        renderResults(S.getVisibleSeries(store).map(viewSeries), computeAnalysis());
      });
      head.appendChild(label);

      var seriesList = S.seriesOfFile(store, entry.id);

      if (seriesList.length > 0) {
        var anyVisible = seriesList.some(function (s) {
          return s.visible;
        });
        var bulk = document.createElement('button');
        bulk.type = 'button';
        bulk.className = 'icon-btn';
        bulk.textContent = anyVisible ? 'Hide all' : 'Show all';
        bulk.title = 'Toggle every series in this file';
        bulk.addEventListener('click', function () {
          S.setFileSeriesVisibility(store, entry.id, !anyVisible);
          render();
        });
        head.appendChild(bulk);
      }

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.textContent = '×';
      remove.title = 'Remove this file';
      remove.addEventListener('click', function () {
        S.removeFile(store, entry.id);
        if (store.files.size === 0) {
          store.axesInitialized = false;
          dropzone.classList.remove('compact');
        }
        rebuildAndRender();
      });
      head.appendChild(remove);

      group.appendChild(head);

      if (entry.error) {
        var err = document.createElement('p');
        err.className = 'file-error';
        err.textContent = entry.error;
        group.appendChild(err);
      }

      entry.warnings.forEach(function (w) {
        var note = document.createElement('p');
        note.className = 'file-note';
        note.textContent = w;
        group.appendChild(note);
      });

      if (seriesList.length > 0) {
        group.appendChild(seriesDetails(entry, seriesList, analysis));
      }

      fileList.appendChild(group);
    });
  }

  function seriesDetails(entry, seriesList, analysis) {
    var details = document.createElement('details');
    details.className = 'series-details';
    details.open = !collapsedSeriesLists.has(entry.id);

    details.addEventListener('toggle', function () {
      if (details.open) collapsedSeriesLists.delete(entry.id);
      else collapsedSeriesLists.add(entry.id);
    });

    var summary = document.createElement('summary');
    summary.className = 'series-summary';
    var shown = seriesList.filter(function (s) {
      return s.visible;
    }).length;
    summary.textContent = seriesList.length + ' series (' + shown + ' shown)';
    details.appendChild(summary);

    var list = document.createElement('ul');
    list.className = 'series-list';
    seriesList.forEach(function (s) {
      list.appendChild(seriesRow(entry, s, analysis));
    });
    details.appendChild(list);
    return details;
  }

  function seriesRow(entry, s, analysis) {
    var li = document.createElement('li');
    // The reset control is a sibling, not a child: a button inside a button is
    // invalid and swallows its own clicks.
    var row = document.createElement('div');
    row.className = 'series-row';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-btn';
    btn.setAttribute('aria-pressed', String(s.visible));
    btn.dataset.seriesId = s.id;
    btn.title =
      'Click to toggle · Double-click to show only this series (within this file)';

    btn.appendChild(legendMarker(seriesColor(entry, s), seriesShape(s)));

    var name = document.createElement('span');
    name.className = 'series-name';
    name.textContent = s.groupLabel || 'All data';
    btn.appendChild(name);

    var meta = document.createElement('span');
    meta.className = 'series-meta';
    var fit = analysis.results[s.id] && analysis.results[s.id].fit;
    meta.textContent =
      analysis.mode === 'fit'
        ? fit && fit.ok
          ? formatNum(fit.slope, SIG_SLOPE)
          : '—'
        : s.points.length + ' pts';
    btn.appendChild(meta);

    btn.addEventListener('click', function () {
      S.toggleSeriesVisibility(store, s.id);
      render();
    });
    btn.addEventListener('dblclick', function () {
      S.isolateSeries(store, s.id);
      render();
    });

    row.appendChild(btn);

    var excluded = s.points.filter(function (p) {
      return p.excluded;
    }).length;
    if (excluded > 0) {
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'icon-btn series-reset';
      reset.textContent = '⟲';
      reset.title = 'Restore ' + excluded + ' excluded point(s) in this series';
      reset.addEventListener('click', function () {
        S.resetExclusions(store, s.id);
        render();
      });
      row.appendChild(reset);
    }

    li.appendChild(row);
    return li;
  }

  /* ---------------- result cards ---------------- */

  function renderResults(visible, analysis) {
    resultCards.textContent = '';

    if (analysis.mode === 'none') {
      resultCards.appendChild(placeholder('Choose an analysis mode to see results.'));
      return;
    }
    if (visible.length === 0) {
      resultCards.appendChild(placeholder('No visible series.'));
      return;
    }
    if (analysis.qError) {
      var warn = document.createElement('p');
      warn.className = 'fit-unavailable';
      warn.textContent = analysis.qError;
      resultCards.appendChild(warn);
    }

    visible.forEach(function (vs) {
      resultCards.appendChild(resultCard(vs, analysis));
    });
  }

  function placeholder(text) {
    var p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = text;
    return p;
  }

  function resultCard(vs, analysis) {
    var result = analysis.results[vs.id] || {};
    var card = document.createElement('div');
    card.className = 'fit-card';

    var head = document.createElement('div');
    head.className = 'fit-card-head';
    head.appendChild(shapeSwatch(vs.color, vs.shape));
    var title = document.createElement('span');
    title.className = 'fit-card-title';
    title.textContent = vs.label;
    head.appendChild(title);
    card.appendChild(head);

    if (analysis.mode === 'fit') {
      var fit = result.fit;
      if (!fit || !fit.ok) {
        var bad = document.createElement('p');
        bad.className = 'fit-unavailable';
        bad.textContent =
          fit && fit.reason === 'degenerate'
            ? 'Cannot fit: every X value is identical'
            : 'Not enough data (' + (fit ? fit.n : 0) + ' points used)';
        card.appendChild(bad);
        card.appendChild(resetButton(vs));
        return card;
      }

      card.appendChild(fitRow('Slope', formatNum(fit.slope, SIG_SLOPE)));

      var eq = document.createElement('button');
      eq.type = 'button';
      eq.className = 'equation';
      eq.textContent = F.formatEquation(fit, 'x', 'y');
      eq.title = 'Click to copy (x and y follow the axis settings above)';
      eq.addEventListener('click', function () {
        var text = eq.textContent;
        copyText(text).then(function (ok) {
          eq.textContent = ok ? 'Copied' : 'Copy failed';
          setTimeout(function () {
            eq.textContent = text;
          }, 900);
        });
      });
      card.appendChild(eq);

      card.appendChild(fitRow('R²', fit.r2.toFixed(4)));
      card.appendChild(fitRow('Points used', fit.n + ' / ' + fit.total));
    }

    if (result.solved) {
      card.appendChild(solutionBlock(result.solved, analysis));
    }

    card.appendChild(resetButton(vs));
    return card;
  }

  function solutionBlock(solved, analysis) {
    var wrap = document.createElement('div');

    if (!solved.ok) {
      var bad = document.createElement('p');
      bad.className = 'result fit-unavailable';
      bad.textContent =
        solved.reason === 'flat-slope'
          ? 'Slope is too close to 0 to invert'
          : solved.reason === 'insufficient-data'
          ? 'Not enough points to interpolate'
          : 'Cannot be solved';
      wrap.appendChild(bad);
      return wrap;
    }

    var toAxis = analysis.toAxis;
    var list = document.createElement('ul');
    list.className = 'result-list';

    solved.values.forEach(function (displayValue) {
      var raw = fromDisplay(displayValue, toAxis.log);
      var li = document.createElement('li');
      var strong = document.createElement('strong');
      strong.textContent = toAxis.column + ' = ' + formatNum(raw, SIG_VALUE);
      li.appendChild(strong);
      if (toAxis.log) {
        var note = document.createElement('span');
        note.className = 'result-note';
        note.textContent = '  (log10 = ' + formatNum(displayValue, SIG_VALUE) + ')';
        li.appendChild(note);
      }
      list.appendChild(li);
    });
    wrap.appendChild(list);

    if (solved.extrapolated) {
      var badge = document.createElement('p');
      badge.className = 'result-note';
      var b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'extrapolated';
      b.title = 'Outside the data range — the end segment was extended';
      badge.appendChild(b);
      var txt = document.createElement('span');
      txt.textContent = ' outside the data range';
      badge.appendChild(txt);
      wrap.appendChild(badge);
    }

    if (solved.values.length > 1) {
      var multi = document.createElement('p');
      multi.className = 'result-note';
      multi.textContent =
        'Data is not monotonic — ' + solved.values.length + ' solutions';
      wrap.appendChild(multi);
    }

    return wrap;
  }

  function fitRow(labelText, valueText) {
    var row = document.createElement('div');
    row.className = 'fit-row';
    var l = document.createElement('span');
    l.textContent = labelText;
    var v = document.createElement('strong');
    v.textContent = valueText;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function resetButton(vs) {
    var wrap = document.createElement('div');
    wrap.className = 'fit-actions';
    var excluded = vs.points.filter(function (p) {
      return p.excluded;
    }).length;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn';
    btn.textContent =
      'Reset exclusions' + (excluded ? ' (' + excluded + ' points)' : '');
    btn.disabled = excluded === 0;
    btn.addEventListener('click', function () {
      S.resetExclusions(store, vs.id);
      render();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  /* ---------------- analysis controls ---------------- */

  function syncCalcControls() {
    var mode = store.analysis.mode;
    calcBlock.hidden = mode === 'none';
    // There is nothing to export when no model is selected; the export itself
    // always reports both models, whichever one is on screen.
    analysisExportRow.hidden = mode === 'none';
    var dir = store.analysis.direction;
    var axis = dir === 'xToY' ? store.axes.x : store.axes.y;
    calcLabel.textContent =
      (dir === 'xToY' ? 'X' : 'Y') +
      ' value' +
      (axis.column ? ' (' + axis.column + ')' : '');
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('input[name="mode"]'),
    function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        store.analysis.mode = radio.value;
        syncCalcControls();
        render();
      });
    }
  );

  Array.prototype.forEach.call(
    document.querySelectorAll('.seg-btn'),
    function (btn) {
      btn.addEventListener('click', function () {
        store.analysis.direction = btn.dataset.dir;
        Array.prototype.forEach.call(
          document.querySelectorAll('.seg-btn'),
          function (other) {
            other.classList.toggle('is-on', other === btn);
          }
        );
        syncCalcControls();
        render();
      });
    }
  );

  calcForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = parseFloat(qInput.value);
    store.analysis.query = isFinite(v) ? v : null;
    render();
  });

  /* ---------------- file loading ---------------- */

  function loadFiles(descriptors) {
    var pending = descriptors.map(function (d) {
      if (!/\.csv$/i.test(d.name)) {
        S.addErrorFile(store, d, 'Not a CSV file');
        return Promise.resolve();
      }
      return Promise.resolve()
        .then(function () {
          return d.text();
        })
        .then(function (text) {
          var parsed = P.parseCsv(text);
          if (!parsed.ok) {
            S.addErrorFile(store, d, parsed.error);
            return;
          }
          S.addFile(store, d, parsed);
        })
        .catch(function () {
          S.addErrorFile(store, d, 'Could not read the file');
        });
    });

    return Promise.all(pending).then(function () {
      if (!store.axesInitialized) S.chooseDefaultAxes(store);
      if (store.files.size > 0) {
        dropzone.classList.add('compact');
        if (!axesPanelAutoOpened) {
          panelAxes.open = true;
          axesPanelAutoOpened = true;
        }
      }
      rebuildAndRender();
    });
  }

  dropzone.addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    loadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', function (e) {
    e.preventDefault();
    // Without an explicit copy effect some browsers treat the drag as a move
    // and refuse the drop.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  });
  // Both dragover and drop must be prevented, or the browser navigates away to
  // render the dropped CSV as a page.
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      loadFiles(Array.from(e.dataTransfer.files));
    }
  });

  /* ---------------- interactions ---------------- */

  function pointKey(node) {
    return node.dataset.seriesId + '#' + node.dataset.pointIndex;
  }

  // Every drawn point whose marker overlaps the clicked one. Markers of radius r
  // overlap once their centres are within 2r.
  function overlappingCluster(target) {
    var tx = parseFloat(target.getAttribute('cx'));
    var ty = parseFloat(target.getAttribute('cy'));
    var limit = C.MARKER_RADIUS * 2;
    var out = [];
    Array.prototype.forEach.call(svg.querySelectorAll('.point-hit'), function (node) {
      var dx = parseFloat(node.getAttribute('cx')) - tx;
      var dy = parseFloat(node.getAttribute('cy')) - ty;
      if (dx * dx + dy * dy <= limit * limit) out.push(node);
    });
    // Stable order so the rotation is reproducible across re-renders.
    out.sort(function (a, b) {
      var ka = pointKey(a);
      var kb = pointKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return out;
  }

  svg.addEventListener('click', function (e) {
    var target = e.target.closest('.point-hit');
    if (!target) return;

    var cluster = overlappingCluster(target);
    var chosen = cluster[0] || target;

    if (cluster.length > 1) {
      // Points stacked on top of each other can't be told apart by aim, so
      // repeated clicks walk through the cluster instead of hitting the same
      // one every time.
      var key = cluster.map(pointKey).join('|');
      var index = key === overlapPick.key ? (overlapPick.index + 1) % cluster.length : 0;
      overlapPick = { key: key, index: index };
      chosen = cluster[index];
    } else {
      overlapPick = { key: null, index: 0 };
    }

    S.togglePointExcluded(
      store,
      chosen.dataset.seriesId,
      parseInt(chosen.dataset.pointIndex, 10)
    );
    render();
  });

  showAllBtn.addEventListener('click', function () {
    S.showAllSeries(store);
    render();
  });

  /* ---------------- export dialog ---------------- */

  // Kept across opens so a chosen set of columns survives repeated exports;
  // null means "not chosen yet", which falls back to the defaults.
  var exportSelection = null;

  function exportLayout() {
    var checked = exportDialog.querySelector('input[name="export-layout"]:checked');
    return checked ? checked.value : 'vertical';
  }

  function checkedKeys() {
    return Array.prototype.filter
      .call(exportColumns.querySelectorAll('input[type="checkbox"]'), function (b) {
        return b.checked;
      })
      .map(function (b) {
        return b.value;
      });
  }

  function updateExportNote() {
    var table = CsvWorkbench.export.buildTable(store, {
      layout: exportLayout(),
      selectedKeys: checkedKeys()
    });
    exportConfirm.disabled = !table;
    if (!table) {
      exportNote.textContent = 'Select at least one column.';
      return;
    }
    exportNote.textContent =
      table.header.length + ' columns × ' + table.rows.length + ' rows';
  }

  function renderExportColumns() {
    var columns = CsvWorkbench.export.availableColumns(store);
    var selected = new Set(
      exportSelection === null
        ? CsvWorkbench.export.defaultSelection(store)
        : exportSelection
    );
    var horizontal = exportLayout() === 'horizontal';

    exportColumns.textContent = '';
    columns.forEach(function (c) {
      var label = document.createElement('label');
      label.className = 'check';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = c.key;
      box.checked = selected.has(c.key);
      // Side by side, the file is named in every column of its block already.
      if (c.kind === 'file' && horizontal) {
        box.checked = false;
        box.disabled = true;
      }
      box.addEventListener('change', function () {
        exportSelection = checkedKeys();
        updateExportNote();
      });
      var text = document.createElement('span');
      text.textContent = c.name;
      text.title = c.name;
      label.appendChild(box);
      label.appendChild(text);
      exportColumns.appendChild(label);
    });
    updateExportNote();
  }

  exportBtn.addEventListener('click', function () {
    renderExportColumns();
    exportDialog.showModal();
  });

  exportAnalysisBtn.addEventListener('click', function () {
    var table = CsvWorkbench.export.buildAnalysisTable(store);
    if (!table) return;
    CsvWorkbench.export.download(
      'csv_workbench_analysis.csv',
      CsvWorkbench.export.toCsv(table.header, table.rows)
    );
  });

  Array.prototype.forEach.call(
    exportDialog.querySelectorAll('input[name="export-layout"]'),
    function (radio) {
      radio.addEventListener('change', renderExportColumns);
    }
  );

  exportAllCols.addEventListener('click', function () {
    Array.prototype.forEach.call(
      exportColumns.querySelectorAll('input[type="checkbox"]'),
      function (b) {
        if (!b.disabled) b.checked = true;
      }
    );
    exportSelection = checkedKeys();
    updateExportNote();
  });

  exportNoCols.addEventListener('click', function () {
    Array.prototype.forEach.call(
      exportColumns.querySelectorAll('input[type="checkbox"]'),
      function (b) {
        b.checked = false;
      }
    );
    exportSelection = checkedKeys();
    updateExportNote();
  });

  exportCancel.addEventListener('click', function () {
    exportDialog.close();
  });

  exportConfirm.addEventListener('click', function () {
    var layout = exportLayout();
    var table = CsvWorkbench.export.buildTable(store, {
      layout: layout,
      selectedKeys: checkedKeys()
    });
    if (!table) return;
    CsvWorkbench.export.download(
      layout === 'horizontal'
        ? 'csv_workbench_export_wide.csv'
        : 'csv_workbench_export.csv',
      CsvWorkbench.export.toCsv(table.header, table.rows)
    );
    exportDialog.close();
  });

  clearAllBtn.addEventListener('click', function () {
    var n = store.files.size;
    if (n === 0) return;
    // Discards every loaded file along with its exclusions and labels, and
    // nothing here is undoable.
    var ok = window.confirm(
      'Remove all ' + n + (n === 1 ? ' file' : ' files') + '?\n' +
        'Labels, hidden series and excluded points will be lost.'
    );
    if (!ok) return;

    S.orderedFiles(store).forEach(function (entry) {
      S.removeFile(store, entry.id);
    });
    store.axesInitialized = false;
    collapsedSeriesLists.clear();
    dropzone.classList.remove('compact');
    rebuildAndRender();
  });

  /* ---------------- URL parameters ---------------- */

  // ?load=<csv url>&x=<col>&y=<col>&xlog=1&ylog=0&group=<col>&group2=<col>&mode=fit&dir=yToX&q=1.5
  // Lets a working setup be bookmarked, and gives the headless verification
  // harness a way to drive the app without synthesising a file drop.
  function fetchDescriptor(url) {
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then(function (text) {
        return {
          name: decodeURIComponent(url.split('/').pop().split('?')[0]),
          // Sibling runs export the same filename and often the same byte
          // length, so the URL is what actually distinguishes them.
          sourceKey: url,
          size: text.length,
          lastModified: 0,
          text: function () {
            return Promise.resolve(text);
          }
        };
      })
      .catch(function () {
        return {
          name: decodeURIComponent(url.split('/').pop().split('?')[0]) || url,
          sourceKey: url,
          size: 0,
          lastModified: 0,
          text: function () {
            return Promise.reject(new Error('fetch failed'));
          }
        };
      });
  }

  function applyPrefs(params) {
    var nums = S.numericColumns(store);
    var all = S.allColumns(store);
    var touchedAxes = false;

    var x = params.get('x');
    if (x && nums.indexOf(x) !== -1) {
      store.axes.x.column = x;
      touchedAxes = true;
    }
    var y = params.get('y');
    if (y && nums.indexOf(y) !== -1) {
      store.axes.y.column = y;
      touchedAxes = true;
    }
    if (params.has('xlog')) {
      store.axes.x.log = params.get('xlog') !== '0';
      touchedAxes = true;
    }
    if (params.has('ylog')) {
      store.axes.y.log = params.get('ylog') !== '0';
      touchedAxes = true;
    }
    if (params.has('group')) {
      var g = params.get('group');
      store.groupColumns[0] = g && all.indexOf(g) !== -1 ? g : null;
      touchedAxes = true;
    }
    if (params.has('group2')) {
      var g2 = params.get('group2');
      store.groupColumns[1] =
        store.groupColumns[0] !== null && g2 && all.indexOf(g2) !== -1 ? g2 : null;
      touchedAxes = true;
    }

    var mode = params.get('mode');
    if (mode === 'fit' || mode === 'interp' || mode === 'none') {
      store.analysis.mode = mode;
      var radio = document.querySelector('input[name="mode"][value="' + mode + '"]');
      if (radio) radio.checked = true;
    }
    var dir = params.get('dir');
    if (dir === 'xToY' || dir === 'yToX') {
      store.analysis.direction = dir;
      Array.prototype.forEach.call(
        document.querySelectorAll('.seg-btn'),
        function (b) {
          b.classList.toggle('is-on', b.dataset.dir === dir);
        }
      );
    }
    var q = params.get('q');
    if (q !== null && isFinite(parseFloat(q))) {
      store.analysis.query = parseFloat(q);
      qInput.value = q;
    }

    syncCalcControls();
    if (touchedAxes) rebuildAndRender();
    else render();
  }

  function applyUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var loads = params.getAll('load');

    // fetch() is blocked under file://, so a bookmarked ?load= silently degrades
    // to the normal drag-and-drop flow rather than erroring.
    if (loads.length === 0 || window.location.protocol === 'file:') {
      applyPrefs(params);
      return;
    }

    Promise.all(loads.map(fetchDescriptor))
      .then(function (descriptors) {
        return loadFiles(descriptors);
      })
      .then(function () {
        applyPrefs(params);
      });
  }

  syncAxisControls();
  syncCalcControls();
  render();
  applyUrlParams();
})();
