// The stand-in for jsPDF's optional peers (vite.config.ts · resolve.alias): `html2canvas`,
// `canvg` and `dompurify`. jsPDF imports them lazily, only inside `.html()` and
// `.addSvgAsImage()`, and the two admin QR sheets (admin/capturePdf, admin/standingAsPdf) draw
// with text and `addImage` alone — yet Vite emitted all three as chunks and the service worker
// precached them on every tablet (~380 kB, sweep 09.11.2026 · CODE.4).
//
// ⚠️ A sheet that starts to use `.html()` or `.addSvgAsImage()` lands here and fails loudly:
// remove the alias for the library it needs, do not work around this.

/** What jsPDF gets instead of the library: a call says which door was opened. */
export default function unbundled(): never {
  throw new Error('jsPDF asked for html2canvas, canvg or dompurify, which this build leaves out (vite.config.ts · resolve.alias)')
}
