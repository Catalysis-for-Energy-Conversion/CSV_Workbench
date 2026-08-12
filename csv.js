window.CsvWorkbench = window.CsvWorkbench || {};

(function () {
  'use strict';

  // Minimal RFC4180 field splitter. Quoted fields spanning a newline are not
  // supported (the caller splits on lines first), but quoted commas are — those
  // do show up in exported column names and label columns.
  function splitCsvLine(line) {
    var out = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // Number('') is 0 and Number('Infinity') is Infinity, so neither can be left
  // to the implicit conversion.
  function toNumber(cell) {
    if (cell === null || cell === undefined) return NaN;
    var t = String(cell).trim();
    if (t === '') return NaN;
    var n = Number(t);
    return isFinite(n) ? n : NaN;
  }

  function uniqueHeader(names) {
    var seen = Object.create(null);
    return names.map(function (raw, i) {
      var name = raw.trim();
      if (name === '') name = 'column ' + (i + 1);
      if (seen[name] === undefined) {
        seen[name] = 1;
        return name;
      }
      var n = seen[name] + 1;
      while (seen[name + ' (' + n + ')'] !== undefined) n++;
      seen[name] = n;
      var unique = name + ' (' + n + ')';
      seen[unique] = 1;
      return unique;
    });
  }

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    // The last column carries the \r under a \n-only split, which silently
    // breaks header-name matching.
    var lines = text.split(/\r\n|\r|\n/);

    var headerIndex = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex === -1) {
      return { ok: false, error: 'File is empty' };
    }

    var header = uniqueHeader(splitCsvLine(lines[headerIndex]));

    var rows = [];
    var raggedRowCount = 0;
    for (var r = headerIndex + 1; r < lines.length; r++) {
      if (lines[r].trim() === '') continue;
      var cells = splitCsvLine(lines[r]);
      if (cells.length !== header.length) raggedRowCount++;
      // Pad so every row can be indexed by column position without a guard.
      while (cells.length < header.length) cells.push('');
      rows.push(cells);
    }

    if (rows.length === 0) {
      return { ok: false, error: 'No data rows' };
    }

    // A column counts as numeric if it holds at least one parseable number;
    // blanks and stray text elsewhere in the column are ignored per-cell.
    var numericColumns = [];
    header.forEach(function (name, ci) {
      var count = 0;
      for (var k = 0; k < rows.length; k++) {
        if (isFinite(toNumber(rows[k][ci]))) count++;
      }
      if (count > 0) {
        numericColumns.push({ name: name, index: ci, count: count });
      }
    });

    if (numericColumns.length === 0) {
      return { ok: false, error: 'No numeric columns found' };
    }

    return {
      ok: true,
      header: header,
      rows: rows,
      numericColumns: numericColumns,
      raggedRowCount: raggedRowCount
    };
  }

  CsvWorkbench.csv = {
    parseCsv: parseCsv,
    splitCsvLine: splitCsvLine,
    uniqueHeader: uniqueHeader,
    toNumber: toNumber
  };
})();
