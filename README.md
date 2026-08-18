# CSV Workbench

Plot columns of a CSV against each other, fit or interpolate the result, read
values off it, and export what you get. Runs entirely in the browser — no
install, no build step, no network.

## What it does

- **Plot** any numeric column against any other, each axis linear or log10
- **Overlay files** — drop several CSVs at once, even with different columns
- **Split into series** by one or two columns
- **Exclude outliers** by clicking them; the axes rescale around what remains
- **Fit or interpolate** — least squares, or piecewise linear between points
- **Solve** — type a value on either axis and get the matching value back
- **Export the plotted data** — stacked into one table or laid side by side,
  with exactly the columns you tick
- **Export the analysis** — slope, intercept, R², and both models' answers at
  your query value, one row per series

## Getting started

Open `index.html` in a modern browser. Chrome and Edge are the tested ones;
Firefox 113+ and Safari 16.2+ have everything it relies on. Any OS — it is
just a page.

Drop CSV files anywhere on the page, choose which columns to use for X and Y,
and the plot appears.

To run it elsewhere, copy the whole folder — the files reference each other by
relative path, so it works from any location as long as the folder stays
intact.

> An editor's built-in browser preview usually breaks drag-and-drop, because
> the editor takes the dropped file before the page sees it. Use a real browser
> window.

## Exporting

Two separate exports, each written as a plain CSV.

**Data** opens a dialog with two choices:

- *Layout* — **vertical** stacks every visible series into one long table;
  **horizontal** gives each series its own block of columns, laid side by side
  and aligned from the top. Side by side, each column is named after the series
  it came from, so nothing is ambiguous once the columns sit together.
- *Columns* — tick exactly what you want. Both the raw and the log10 form of
  each axis are always available, whichever way the axis happens to be drawn.

Rows come out in the order they appear in the source file — a sweep or a time
series reads back the way it was recorded, whichever way the plot happens to
run. Hidden series produce no rows at all. Excluded points keep their row, with
the X and Y reported as `NaN`, so the row count still matches the source.

**Analysis** writes one row per visible series: the fit's slope and intercept
(with their units spelled out in the heading), R², how many points were used,
and *both* models' answers — whichever mode is on screen, you get the fit and
the interpolation. Headings name the question being asked, for example
`fit: current at voltage=1.5`, so a file opened months later still says what it
holds. Interpolation beyond the span it covers reports `NaN`; the fit answers
but is flagged as extrapolated.

## Using it

**Axes** — Pick any numeric column for X and Y, each independently linear or
log10. The choices come from every loaded file combined, so files with
different layouts can be mixed; a file missing the chosen column says so and
steps aside instead of breaking the others.

**Grouping** — Split each file into series by one or two columns. Series can be
shown, hidden, or isolated within their own file.

**Telling series apart** — Hue and marker shape identify the file; shade
identifies the group within it. Past the point where more files would crowd the
colour wheel, the marker shape advances instead, so files stay distinguishable
well beyond where colour alone would fail.

**Excluding points** — Click a point to drop it from the analysis, click again
to restore it. Excluded points stay drawn but hollow, and the axes rescale
around what is left. Where markers overlap, repeated clicks cycle through them.
Exclusions are tied to the source row, so they survive changing the axes or the
grouping.

**Analysis** — None, linear fit, or linear interpolation. Enter a value and
solve in either direction. Answers outside the data range are flagged rather
than passed off as measurements.

## Layout

| File | Holds |
| --- | --- |
| `index.html` | Markup and the export dialog |
| `style.css` | Styling, including the light and dark palettes |
| `csv.js` | CSV parsing and numeric-column detection |
| `series.js` | The store: files, axes, grouping, visibility, exclusions |
| `fit.js` | Least squares, interpolation, and solving in either direction |
| `chart.js` | SVG rendering, axis scaling and tick formatting |
| `export.js` | Column selection and the two export layouts |
| `main.js` | Wiring, rendering the panels, file loading |

## License

MIT — see [LICENSE](LICENSE).
