window.CsvWorkbench = window.CsvWorkbench || {};

(function () {
  'use strict';

  var toNumber = CsvWorkbench.csv.toNumber;

  // Hue and shape both identify the file; shade is reserved for the groups
  // within it. With few files the wheel is divided evenly for maximum
  // separation, but past HUE_COUNT the hues sit too close to read apart, so the
  // hue repeats and the marker shape advances instead.
  var HUE_START = 250;
  var HUE_COUNT = 6;

  // Every series uses the same coarse dash; series within a file are told apart
  // by a pale-to-deep shade of the file's colour instead of by line style.
  var SERIES_DASH = '6 3';
  var SHADE_MIN = 30;
  var SHAPE_COUNT = 6;

  // Preferred axis assignment when the familiar Tafel columns are present.
  var TAFEL_X = 'j/mA cm-2';
  var TAFEL_Y = 'V_vs_RHE_iR_corrected';
  var DEFAULT_GROUP = 'cycle';

  function createStore() {
    return {
      files: new Map(),
      series: new Map(),
      nextFileCounter: 0,
      axes: {
        x: { column: null, log: false },
        y: { column: null, log: false }
      },
      // Up to two grouping dimensions; either slot may be null.
      groupColumns: [null, null],
      analysis: { mode: 'none', direction: 'xToY', query: null },
      axesInitialized: false
    };
  }

  // shade is the percentage of the file's base colour retained; the remainder is
  // mixed with the surface, so the ramp reads pale-to-deep in either theme. All
  // groups of a file share its marker shape and differ only in shade.
  function seriesVariant(series) {
    var n = series.variantCount || 1;
    var t = n <= 1 ? 1 : series.variantIndex / (n - 1);
    return { dash: SERIES_DASH, shade: SHADE_MIN + (100 - SHADE_MIN) * t };
  }

  // Hue and shape for a file, recomputed from the current file list so adding
  // or removing a file redistributes everything.
  function fileVariant(store, fileEntry) {
    var files = orderedFiles(store);
    var index = 0;
    for (var i = 0; i < files.length; i++) {
      if (files[i].id === fileEntry.id) {
        index = i;
        break;
      }
    }
    // Spread evenly while the hues stay far apart, then reuse them and step the
    // shape, so file 7 is a different shape from file 1 rather than a hue that
    // is only a few degrees away from it.
    var hueSlots = Math.min(Math.max(files.length, 1), HUE_COUNT);
    return {
      hue: (HUE_START + (360 / hueSlots) * (index % hueSlots)) % 360,
      shapeIndex: Math.floor(index / hueSlots) % SHAPE_COUNT
    };
  }

  function deriveDefaultLabel(rawName, store) {
    var taken = new Set();
    store.files.forEach(function (f) {
      taken.add(f.label);
    });
    if (!taken.has(rawName)) return rawName;
    var n = 2;
    while (taken.has(rawName + ' (' + n + ')')) n++;
    return rawName + ' (' + n + ')';
  }

  // Identity of a source, used to decide whether a load replaces an existing
  // entry or adds a new one. A dropped File is identified by name + size +
  // mtime; anything fetched by URL carries its own sourceKey, because sibling
  // runs export the same filename and can easily share a byte length too.
  function sourceKeyOf(file) {
    return (
      file.sourceKey ||
      file.name + '|' + file.size + '|' + file.lastModified
    );
  }

  function findExistingFile(store, file) {
    var key = sourceKeyOf(file);
    var found = null;
    store.files.forEach(function (entry) {
      if (found === null && entry.sourceKey === key) found = entry;
    });
    return found;
  }

  /* ---------------- column inventory ---------------- */

  // Union across files, in first-seen order, so the axis selects stay stable as
  // more files arrive.
  function allColumns(store) {
    var seen = [];
    var taken = new Set();
    store.files.forEach(function (entry) {
      (entry.header || []).forEach(function (name) {
        if (!taken.has(name)) {
          taken.add(name);
          seen.push(name);
        }
      });
    });
    return seen;
  }

  function numericColumns(store) {
    var seen = [];
    var taken = new Set();
    store.files.forEach(function (entry) {
      (entry.numericColumns || []).forEach(function (col) {
        if (!taken.has(col.name)) {
          taken.add(col.name);
          seen.push(col.name);
        }
      });
    });
    return seen;
  }

  function chooseDefaultAxes(store) {
    var nums = numericColumns(store);
    if (nums.length === 0) return;

    var hasTafel = nums.indexOf(TAFEL_X) !== -1 && nums.indexOf(TAFEL_Y) !== -1;
    if (hasTafel) {
      store.axes.x = { column: TAFEL_X, log: true };
      store.axes.y = { column: TAFEL_Y, log: false };
    } else {
      store.axes.x = { column: nums[0], log: false };
      store.axes.y = { column: nums.length > 1 ? nums[1] : nums[0], log: false };
    }

    store.groupColumns = [
      allColumns(store).indexOf(DEFAULT_GROUP) !== -1 ? DEFAULT_GROUP : null,
      null
    ];
    store.axesInitialized = true;
  }

  /* ---------------- file add / remove ---------------- */

  function addFile(store, file, parsed) {
    var existing = findExistingFile(store, file);
    if (existing) {
      existing.header = parsed.header;
      existing.rows = parsed.rows;
      existing.numericColumns = parsed.numericColumns;
      existing.raggedRowCount = parsed.raggedRowCount;
      existing.loadError = null;
      return { fileEntry: existing, replaced: true };
    }

    var fileId = 'f' + store.nextFileCounter++;
    var entry = {
      id: fileId,
      label: deriveDefaultLabel(file.name, store),
      rawName: file.name,
      sourceKey: sourceKeyOf(file),
      size: file.size,
      lastModified: file.lastModified,
      header: parsed.header,
      rows: parsed.rows,
      numericColumns: parsed.numericColumns,
      raggedRowCount: parsed.raggedRowCount,
      // Keyed by source row index and group key so both survive an axis change.
      excludedRows: new Set(),
      hiddenGroups: new Set(),
      loadError: null,
      error: null,
      warnings: [],
      seriesIds: []
    };
    store.files.set(fileId, entry);
    return { fileEntry: entry, replaced: false };
  }

  function addErrorFile(store, file, message) {
    var existing = findExistingFile(store, file);
    if (existing) {
      existing.loadError = message;
      existing.rows = [];
      existing.header = [];
      existing.numericColumns = [];
      return existing;
    }
    var fileId = 'f' + store.nextFileCounter++;
    var entry = {
      id: fileId,
      label: deriveDefaultLabel(file.name, store),
      rawName: file.name,
      sourceKey: sourceKeyOf(file),
      size: file.size,
      lastModified: file.lastModified,
      header: [],
      rows: [],
      numericColumns: [],
      raggedRowCount: 0,
      excludedRows: new Set(),
      hiddenGroups: new Set(),
      loadError: message,
      error: message,
      warnings: [],
      seriesIds: []
    };
    store.files.set(fileId, entry);
    return entry;
  }

  function removeFile(store, fileId) {
    var entry = store.files.get(fileId);
    if (!entry) return;
    entry.seriesIds.forEach(function (sid) {
      store.series.delete(sid);
    });
    store.files.delete(fileId);
  }

  /* ---------------- series construction ---------------- */

  // Raw value <-> the space the chart, fits and interpolation all work in.
  function toDisplay(value, log) {
    return log ? Math.log10(value) : value;
  }

  function fromDisplay(value, log) {
    return log ? Math.pow(10, value) : value;
  }

  // Sorts group descriptors ({values: [...]}) lexicographically over their
  // dimensions, comparing each dimension numerically if every value in it
  // parses as a number and as plain strings otherwise. Works for any number
  // of dimensions, including the single- and zero-dimension cases.
  function sortGroupDescriptors(descriptors) {
    var dims = descriptors.length > 0 ? descriptors[0].values.length : 0;
    var numericByDim = [];
    for (var d = 0; d < dims; d++) {
      numericByDim.push(
        descriptors.every(function (g) {
          var v = g.values[d];
          return v !== '' && isFinite(toNumber(v));
        })
      );
    }
    descriptors.sort(function (a, b) {
      for (var i = 0; i < dims; i++) {
        var av = a.values[i];
        var bv = b.values[i];
        var c = numericByDim[i] ? toNumber(av) - toNumber(bv) : av < bv ? -1 : av > bv ? 1 : 0;
        if (c !== 0) return c;
      }
      return 0;
    });
    return descriptors;
  }

  function buildFileSeries(store, entry) {
    var ax = store.axes;
    var xi = entry.header.indexOf(ax.x.column);
    var yi = entry.header.indexOf(ax.y.column);

    var missing = [];
    if (ax.x.column === null || xi === -1) missing.push('X "' + ax.x.column + '"');
    if (ax.y.column === null || yi === -1) missing.push('Y "' + ax.y.column + '"');
    if (missing.length > 0) {
      entry.error = 'Column not present in this file: ' + missing.join(', ');
      return;
    }

    // Each of the (up to two) grouping columns is resolved independently, so a
    // column missing from this particular file just drops out of the grouping
    // instead of collapsing everything down to one series.
    var groupIdx = [];
    store.groupColumns.forEach(function (col) {
      if (col === null) return;
      var gi = entry.header.indexOf(col);
      if (gi === -1) {
        entry.warnings.push('Group column "' + col + '" not present — ignored for this file');
      } else {
        groupIdx.push({ column: col, index: gi });
      }
    });

    var groups = new Map();
    var skippedNonNumeric = 0;
    var droppedLogX = 0;
    var droppedLogY = 0;

    for (var r = 0; r < entry.rows.length; r++) {
      var cells = entry.rows[r];
      var xRaw = toNumber(cells[xi]);
      var yRaw = toNumber(cells[yi]);
      if (!isFinite(xRaw) || !isFinite(yRaw)) {
        skippedNonNumeric++;
        continue;
      }
      // log10 is undefined at or below zero; drop rather than take abs, which
      // would silently flip the sign of the point.
      if (ax.x.log && xRaw <= 0) {
        droppedLogX++;
        continue;
      }
      if (ax.y.log && yRaw <= 0) {
        droppedLogY++;
        continue;
      }

      var values = groupIdx.map(function (g) {
        return String(cells[g.index] === undefined ? '' : cells[g.index]).trim();
      });
      var key = JSON.stringify(values);
      if (!groups.has(key)) groups.set(key, { values: values, points: [] });
      groups.get(key).points.push({
        rowIndex: r,
        xRaw: xRaw,
        yRaw: yRaw,
        x: toDisplay(xRaw, ax.x.log),
        y: toDisplay(yRaw, ax.y.log),
        excluded: entry.excludedRows.has(r)
      });
    }

    if (skippedNonNumeric > 0) {
      entry.warnings.push(skippedNonNumeric + ' rows skipped (X or Y not numeric)');
    }
    if (droppedLogX > 0) {
      entry.warnings.push(droppedLogX + ' points dropped (X ≤ 0, log10 undefined)');
    }
    if (droppedLogY > 0) {
      entry.warnings.push(droppedLogY + ' points dropped (Y ≤ 0, log10 undefined)');
    }

    if (groups.size === 0) {
      entry.error = 'No plottable points for this pair of axes';
      return;
    }

    var descriptors = sortGroupDescriptors(
      Array.from(groups.entries()).map(function (kv) {
        return { key: kv[0], values: kv[1].values, points: kv[1].points };
      })
    );

    // Points stay in source-row order: that order is data (a sweep, a time
    // series) and the export reproduces it. Anything needing them ordered along
    // X — the drawn polyline, the interpolation — sorts its own copy.
    descriptors.forEach(function (d, variantIndex) {
      var series = {
        id: entry.id + '::g' + variantIndex,
        fileId: entry.id,
        groupKey: d.key,
        groupValues: d.values,
        groupColumnNames: groupIdx.map(function (g) {
          return g.column;
        }),
        variantCount: descriptors.length,
        groupLabel:
          groupIdx.length === 0
            ? null
            : groupIdx
                .map(function (g, i) {
                  return g.column + ' ' + d.values[i];
                })
                .join(' · '),
        points: d.points,
        visible: !entry.hiddenGroups.has(d.key),
        variantIndex: variantIndex
      };
      entry.seriesIds.push(series.id);
      store.series.set(series.id, series);
    });
  }

  // Removing a file can take the last copy of a selected column with it. Left
  // alone the store would keep naming a column nothing provides any more, and
  // every remaining file would report it as missing.
  function reconcileAxes(store) {
    var nums = numericColumns(store);
    var all = allColumns(store);

    if (nums.length === 0) {
      store.axes.x.column = null;
      store.axes.y.column = null;
    } else {
      if (nums.indexOf(store.axes.x.column) === -1) store.axes.x.column = nums[0];
      if (nums.indexOf(store.axes.y.column) === -1) {
        store.axes.y.column = nums.length > 1 ? nums[1] : nums[0];
      }
    }

    store.groupColumns = store.groupColumns.map(function (col) {
      return col !== null && all.indexOf(col) === -1 ? null : col;
    });
    // A second grouping level without a first is meaningless.
    if (store.groupColumns[0] === null) store.groupColumns[1] = null;
  }

  // Called whenever the axes, log flags or group column change. Rebuilding from
  // the retained raw cells means an axis change never needs the files re-read.
  function rebuildAllSeries(store) {
    reconcileAxes(store);
    store.series.clear();
    store.files.forEach(function (entry) {
      entry.seriesIds = [];
      entry.warnings = [];
      entry.error = entry.loadError;
      if (entry.loadError) return;
      if (entry.raggedRowCount > 0) {
        entry.warnings.push(
          entry.raggedRowCount + ' rows had a different column count (treated as blank)'
        );
      }
      buildFileSeries(store, entry);
    });
  }

  /* ---------------- visibility ---------------- */

  function applyVisibility(store) {
    store.files.forEach(function (entry) {
      entry.seriesIds.forEach(function (sid) {
        var s = store.series.get(sid);
        if (s) s.visible = !entry.hiddenGroups.has(s.groupKey);
      });
    });
  }

  function toggleSeriesVisibility(store, seriesId) {
    var s = store.series.get(seriesId);
    if (!s) return;
    var entry = store.files.get(s.fileId);
    if (!entry) return;
    if (entry.hiddenGroups.has(s.groupKey)) entry.hiddenGroups.delete(s.groupKey);
    else entry.hiddenGroups.add(s.groupKey);
    applyVisibility(store);
  }

  function setFileSeriesVisibility(store, fileId, visible) {
    var entry = store.files.get(fileId);
    if (!entry) return;
    if (visible) {
      entry.hiddenGroups.clear();
    } else {
      entry.seriesIds.forEach(function (sid) {
        var s = store.series.get(sid);
        if (s) entry.hiddenGroups.add(s.groupKey);
      });
    }
    applyVisibility(store);
  }

  // Scoped to the series' own file: isolating a group inside one CSV leaves
  // every other CSV's visibility exactly as the user left it.
  function isolateSeries(store, seriesId) {
    var target = store.series.get(seriesId);
    if (!target) return;
    var entry = store.files.get(target.fileId);
    if (!entry) return;
    entry.seriesIds.forEach(function (sid) {
      var s = store.series.get(sid);
      if (!s) return;
      if (sid === seriesId) entry.hiddenGroups.delete(s.groupKey);
      else entry.hiddenGroups.add(s.groupKey);
    });
    applyVisibility(store);
  }

  function showAllSeries(store) {
    store.files.forEach(function (entry) {
      entry.hiddenGroups.clear();
    });
    applyVisibility(store);
  }

  /* ---------------- point exclusion ---------------- */

  function togglePointExcluded(store, seriesId, pointIndex) {
    var s = store.series.get(seriesId);
    if (!s || !s.points[pointIndex]) return;
    var entry = store.files.get(s.fileId);
    if (!entry) return;
    var rowIndex = s.points[pointIndex].rowIndex;
    if (entry.excludedRows.has(rowIndex)) entry.excludedRows.delete(rowIndex);
    else entry.excludedRows.add(rowIndex);
    s.points[pointIndex].excluded = entry.excludedRows.has(rowIndex);
  }

  function resetExclusions(store, seriesId) {
    var s = store.series.get(seriesId);
    if (!s) return;
    var entry = store.files.get(s.fileId);
    if (!entry) return;
    s.points.forEach(function (p) {
      entry.excludedRows.delete(p.rowIndex);
      p.excluded = false;
    });
  }

  /* ---------------- lookups ---------------- */

  function orderedFiles(store) {
    return Array.from(store.files.values());
  }

  function seriesOfFile(store, fileId) {
    var entry = store.files.get(fileId);
    if (!entry) return [];
    return entry.seriesIds
      .map(function (sid) {
        return store.series.get(sid);
      })
      .filter(Boolean);
  }

  function getVisibleSeries(store) {
    var out = [];
    orderedFiles(store).forEach(function (entry) {
      seriesOfFile(store, entry.id).forEach(function (s) {
        if (s.visible) out.push(s);
      });
    });
    return out;
  }

  CsvWorkbench.series = {
    createStore: createStore,
    addFile: addFile,
    addErrorFile: addErrorFile,
    removeFile: removeFile,
    toDisplay: toDisplay,
    fromDisplay: fromDisplay,
    rebuildAllSeries: rebuildAllSeries,
    reconcileAxes: reconcileAxes,
    chooseDefaultAxes: chooseDefaultAxes,
    allColumns: allColumns,
    numericColumns: numericColumns,
    toggleSeriesVisibility: toggleSeriesVisibility,
    setFileSeriesVisibility: setFileSeriesVisibility,
    isolateSeries: isolateSeries,
    showAllSeries: showAllSeries,
    togglePointExcluded: togglePointExcluded,
    resetExclusions: resetExclusions,
    getVisibleSeries: getVisibleSeries,
    orderedFiles: orderedFiles,
    seriesOfFile: seriesOfFile,
    fileVariant: fileVariant,
    seriesVariant: seriesVariant,
    deriveDefaultLabel: deriveDefaultLabel
  };
})();
