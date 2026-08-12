window.CsvWorkbench = window.CsvWorkbench || {};

(function () {
  'use strict';

  function escapeCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(header, rows) {
    var lines = [header.map(escapeCell).join(',')];
    rows.forEach(function (r) {
      lines.push(r.map(escapeCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // Two files can carry the same label (they are editable), which would
  // otherwise put literally identical column names side by side.
  function uniqueNames(names) {
    return CsvWorkbench.csv.uniqueHeader(names);
  }

  // Descriptors for every column the export could emit, in output order. Keys
  // rather than names identify a column, because names can collide — X and Y
  // are the same column whenever someone plots one against itself.
  //
  //   file            the file label
  //   group:<col>     a grouping column
  //   x / xlog        the X axis raw and as log10, offered whichever way the
  //   y / ylog        axis happens to be drawn; same for Y
  //   raw:<col>       everything else the contributing files carry
  function availableColumns(store) {
    var S = CsvWorkbench.series;
    var axes = store.axes;
    var groupCols = store.groupColumns.filter(Boolean);

    var columns = [
      { key: 'file', name: 'file', kind: 'file', defaultOn: false }
    ];
    groupCols.forEach(function (col) {
      columns.push({ key: 'group:' + col, name: col, kind: 'group', column: col, defaultOn: true });
    });

    // Both forms of each axis are always available; the one matching how the
    // axis is currently plotted is the one checked by default.
    [
      { kind: 'x', keys: ['x', 'xlog'], axis: axes.x },
      { kind: 'y', keys: ['y', 'ylog'], axis: axes.y }
    ].forEach(function (a) {
      if (!a.axis.column) return;
      columns.push({
        key: a.keys[0],
        name: a.axis.column,
        kind: a.kind,
        log: false,
        defaultOn: !a.axis.log
      });
      columns.push({
        key: a.keys[1],
        name: 'log10(' + a.axis.column + ')',
        kind: a.kind,
        log: true,
        defaultOn: a.axis.log
      });
    });

    // Only the files that actually contribute rows, in first-seen order.
    var claimed = new Set(groupCols.concat([axes.x.column, axes.y.column]));
    var contributing = new Set(
      S.getVisibleSeries(store).map(function (s) {
        return s.fileId;
      })
    );
    var seen = new Set();
    S.orderedFiles(store).forEach(function (entry) {
      if (!contributing.has(entry.id)) return;
      entry.header.forEach(function (name) {
        if (claimed.has(name) || seen.has(name)) return;
        seen.add(name);
        columns.push({
          key: 'raw:' + name,
          name: name,
          kind: 'raw',
          column: name,
          defaultOn: false
        });
      });
    });
    return columns;
  }

  function defaultSelection(store) {
    return availableColumns(store)
      .filter(function (c) {
        return c.defaultOn;
      })
      .map(function (c) {
        return c.key;
      });
  }

  // log10 is undefined at or below zero, which is reachable here: a linear axis
  // keeps non-positive points that a log axis would have dropped.
  function axisCell(raw, excluded, wantLog) {
    if (excluded) return 'NaN';
    if (!wantLog) return raw;
    return raw > 0 ? Math.log10(raw) : 'NaN';
  }

  // One point's value for a given column. Excluded points keep their row but
  // report X/Y as NaN; their other columns stay as recorded.
  function cellValue(column, series, point, entry) {
    if (column.kind === 'file') return entry.label;
    if (column.kind === 'x') return axisCell(point.xRaw, point.excluded, column.log);
    if (column.kind === 'y') return axisCell(point.yRaw, point.excluded, column.log);
    if (column.kind === 'group') {
      // groupColumnNames follows the columns present in this file, which can be
      // shorter than the store's grouping when a file lacks one of them.
      var at = series.groupColumnNames.indexOf(column.column);
      return at === -1 ? '' : series.groupValues[at];
    }
    var ci = entry.header.indexOf(column.column);
    if (ci === -1) return '';
    var cells = entry.rows[point.rowIndex] || [];
    return cells[ci] === undefined ? '' : cells[ci];
  }

  // Identifies a series in a column name: the file label, plus each grouping
  // dimension as column+value so a bare "1" is never left to interpret.
  function blockSuffix(series, entry) {
    var parts = [entry.label];
    (series.groupColumnNames || []).forEach(function (col, i) {
      parts.push(col + series.groupValues[i]);
    });
    return parts.join('_');
  }

  function selectedColumns(store, selectedKeys) {
    var wanted = new Set(selectedKeys || defaultSelection(store));
    return availableColumns(store).filter(function (c) {
      return wanted.has(c.key);
    });
  }

  // Every visible series stacked into one long table.
  function buildVertical(store, columns) {
    var S = CsvWorkbench.series;
    var rows = [];
    S.getVisibleSeries(store).forEach(function (s) {
      var entry = store.files.get(s.fileId);
      if (!entry) return;
      s.points.forEach(function (p) {
        rows.push(
          columns.map(function (c) {
            return cellValue(c, s, p, entry);
          })
        );
      });
    });
    return {
      header: uniqueNames(
        columns.map(function (c) {
          return c.name;
        })
      ),
      rows: rows
    };
  }

  // Every visible series as its own block of columns, laid side by side and
  // aligned by position. Blocks with fewer points are padded with blanks.
  function buildHorizontal(store, columns) {
    var S = CsvWorkbench.series;
    // The file is named in every column of its block, so a separate file column
    // would just repeat it.
    var cols = columns.filter(function (c) {
      return c.kind !== 'file';
    });

    var header = [];
    var blocks = [];
    S.getVisibleSeries(store).forEach(function (s) {
      var entry = store.files.get(s.fileId);
      if (!entry) return;
      var suffix = blockSuffix(s, entry);
      cols.forEach(function (c) {
        header.push(c.name + '_' + suffix);
      });
      blocks.push({ series: s, entry: entry });
    });

    var height = blocks.reduce(function (n, b) {
      return Math.max(n, b.series.points.length);
    }, 0);

    var rows = [];
    for (var r = 0; r < height; r++) {
      var row = [];
      blocks.forEach(function (b) {
        var p = b.series.points[r];
        cols.forEach(function (c) {
          row.push(p === undefined ? '' : cellValue(c, b.series, p, b.entry));
        });
      });
      rows.push(row);
    }
    return { header: uniqueNames(header), rows: rows };
  }

  function buildTable(store, options) {
    options = options || {};
    if (CsvWorkbench.series.getVisibleSeries(store).length === 0) return null;

    var columns = selectedColumns(store, options.selectedKeys);
    if (columns.length === 0) return null;

    return options.layout === 'horizontal'
      ? buildHorizontal(store, columns)
      : buildVertical(store, columns);
  }

  /* ---------------- analysis results ---------------- */

  function axisName(axisConfig) {
    return axisConfig.log ? 'log10(' + axisConfig.column + ')' : axisConfig.column;
  }

  function groupCells(series, groupCols) {
    return groupCols.map(function (col) {
      var at = series.groupColumnNames.indexOf(col);
      return at === -1 ? '' : series.groupValues[at];
    });
  }

  // One row per visible series, carrying both models regardless of which one is
  // on screen: the fit's coefficients and quality, and each model's answer at
  // the current query value.
  function buildAnalysisTable(store) {
    var S = CsvWorkbench.series;
    var F = CsvWorkbench.fit;

    var visible = S.getVisibleSeries(store);
    if (visible.length === 0) return null;

    var axes = store.axes;
    var dir = store.analysis.direction;
    var fromAxis = dir === 'xToY' ? axes.x : axes.y;
    var toAxis = dir === 'xToY' ? axes.y : axes.x;

    var qRaw = store.analysis.query;
    var qDisplay = null;
    if (qRaw !== null && !(fromAxis.log && qRaw <= 0)) {
      qDisplay = S.toDisplay(qRaw, fromAxis.log);
    }

    var groupCols = store.groupColumns.filter(Boolean);
    var header = ['file'].concat(groupCols);
    // a and b describe the line in the space that is plotted, so the units are
    // spelled out rather than left to be inferred from the axis toggles.
    header.push('fit_a (' + axisName(axes.y) + ' per ' + axisName(axes.x) + ')');
    header.push('fit_b (' + axisName(axes.y) + ')');
    header.push('fit_R2', 'fit_points_used', 'fit_points_total');

    var at = '';
    if (qDisplay !== null) {
      at = ' at ' + fromAxis.column + '=' + qRaw;
      header.push('fit: ' + toAxis.column + at);
      if (toAxis.log) header.push('fit: log10(' + toAxis.column + ')' + at);
      header.push('fit_extrapolated');
      header.push('interp: ' + toAxis.column + at);
      if (toAxis.log) header.push('interp: log10(' + toAxis.column + ')' + at);
    }

    var rows = visible.map(function (s) {
      var entry = store.files.get(s.fileId);
      var row = [entry ? entry.label : ''].concat(groupCells(s, groupCols));

      var fit = F.fitSeries(s.points);
      row.push(fit.ok ? fit.slope : 'NaN');
      row.push(fit.ok ? fit.intercept : 'NaN');
      row.push(fit.ok ? fit.r2 : 'NaN');
      row.push(fit.ok ? fit.n : 0);
      row.push(s.points.length);

      if (qDisplay === null) return row;

      var solvedFit = fit.ok ? F.solveFit(fit, qDisplay, dir) : { ok: false };
      if (solvedFit.ok) {
        row.push(S.fromDisplay(solvedFit.values[0], toAxis.log));
        if (toAxis.log) row.push(solvedFit.values[0]);
        row.push(solvedFit.extrapolated ? 'yes' : 'no');
      } else {
        row.push('NaN');
        if (toAxis.log) row.push('NaN');
        row.push('');
      }

      // Interpolation only speaks for the span it covers; beyond that the
      // answer would be an extension of the end segment, not an interpolation.
      var interp = F.interpolate(s.points, qDisplay, dir);
      if (!interp.ok || interp.extrapolated) {
        row.push('NaN');
        if (toAxis.log) row.push('NaN');
      } else {
        // A non-monotonic series can cross the query value more than once.
        row.push(
          interp.values
            .map(function (v) {
              return S.fromDisplay(v, toAxis.log);
            })
            .join(';')
        );
        if (toAxis.log) row.push(interp.values.join(';'));
      }
      return row;
    });

    return { header: uniqueNames(header), rows: rows };
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some builds.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  CsvWorkbench.export = {
    availableColumns: availableColumns,
    defaultSelection: defaultSelection,
    buildTable: buildTable,
    buildAnalysisTable: buildAnalysisTable,
    toCsv: toCsv,
    download: download,
    escapeCell: escapeCell
  };
})();
