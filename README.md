# CSV Workbench

A single-page tool for plotting CSV columns against each other, fitting or
interpolating the result, and reading values back out.

Drop one or more CSV files onto the page, pick which columns become X and Y,
and the plot appears. From there you can split each file into series, exclude
points by clicking them, fit a line or interpolate, solve for a value in either
direction, and export both the plotted data and the analysis results.

It grew out of reading Tafel plots from EC-Lab exports, but nothing about it is
specific to that: any CSV with numeric columns works.

## Running it

No build step, no dependencies, no network access. Open `index.html` in a
modern browser — Chrome or Edge are the tested ones.

Copy the whole folder to run it elsewhere; the files reference each other by
relative path, so the folder can live anywhere as long as it stays intact.

> Opening `index.html` from inside an editor's built-in browser preview usually
> breaks drag-and-drop, because the editor intercepts the file drop before the
> page sees it. Use a real browser window.

## What it does

**Axes** — Choose any numeric column for X and Y, each independently plottable
on a linear or log10 scale. Columns are offered from the union of every loaded
file, so files with different layouts can be mixed; a file missing the chosen
column says so and steps aside instead of breaking the others.

**Grouping** — Split each file into series by one or two columns (for example
`cycle`, then `step`). Series can be shown, hidden, or isolated within their own
file.

**Telling series apart** — Hue and marker shape identify the file; shade
identifies the group within it. With more files than distinct hues, the shape
advances rather than the hues crowding together, so files stay distinguishable
well past the point where colour alone would fail.

**Excluding points** — Click a point to drop it from the analysis and click
again to restore it. Excluded points stay drawn but hollow, and the axes rescale
around what remains. Where markers overlap, repeated clicks cycle through them.
Exclusions follow the source row, so they survive changing the axes or the
grouping.

**Analysis** — None, linear fit, or linear interpolation. Enter a value and
solve in either direction (X→Y or Y→X). Results outside the data range are
flagged; a fit reports slope, intercept, R² and the number of points used.

**Export** — Two separate exports:

- *Data*: the plotted points, either stacked into one long table or laid out
  side by side with one block of columns per series. Pick exactly which columns
  to include; both the raw and log10 form of each axis are always on offer.
  Hidden series contribute no rows, and excluded points keep their row with the
  X/Y reported as `NaN`.
- *Analysis*: one row per visible series with the fit's coefficients and both
  models' answers at the current query value. Column headings name the query
  ("`fit: j/mA cm-2 at V_vs_RHE_iR_corrected=1.5`") so a file read months later
  still says what it holds. Interpolation outside the covered span reports
  `NaN`; the fit answers but is marked as extrapolated.

## URL parameters

Loading files by URL needs the page served over HTTP — browsers block `fetch()`
under `file://`. This is entirely optional; drag-and-drop needs none of it.

```
python -m http.server 8765 --bind 127.0.0.1
```

Then, from the directory holding both the app and the data:

```
index.html?load=<csv url>&x=<column>&y=<column>&xlog=1&ylog=0
          &group=<column>&group2=<column>&mode=fit&dir=yToX&q=1.5
```

`load` may be repeated. Bookmarking such a URL reopens a working setup in one
click. Under `file://` the `load` parameter is ignored rather than erroring.

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
