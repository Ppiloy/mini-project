# Local acceptance observations

Status: partial; integrated and hosted acceptance remain open.

Root measured the shared calculator on this Windows machine with Node.js 24.19.0 using a complete supported 20-source fixture, 50 warmups and 300 calculations: median 0.504 ms, 95th percentile 0.863 ms, maximum 1.311 ms. The output was ready. This measures only the pure calculator; browser rendering, API latency and classroom-device behavior are not established. The ignored measurement script is `tmp/ftc-calculation-benchmark.ts`.

Read-only acceptance preparation at `464ee83` passed all 11 actual-backend browser journeys, one focused UI probe and two existing keyboard/offline-font-print tests. At a 390px viewport the document width was 390px; a 134-character filename row fit its 300px content width. A 20-source fixture rendered, print CSS hid the toolbar and permitted table content, and Chromium produced a 168,147-byte PDF in memory. The probe did not render/visually inspect that PDF, and the limited keyboard checks do not establish the complete workflow by keyboard. Earlier root QA rendered and viewed every page of the unchanged four-page sample PDF with Thai glyphs and totals intact. Exact local crosswalk and limits are in external `ftc-acceptance-crosswalk.md`. Hosted service/device/recovery/usage gates remain open.
