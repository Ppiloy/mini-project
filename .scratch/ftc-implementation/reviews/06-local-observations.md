# Local acceptance observations

Status: partial; integrated and hosted acceptance remain open.

Root measured the shared calculator on this Windows machine with Node.js 24.19.0 using a complete supported 20-source fixture, 50 warmups and 300 calculations: median 0.504 ms, 95th percentile 0.863 ms, maximum 1.311 ms. The output was ready. This measures only the pure calculator; browser rendering, API latency and classroom-device behavior are not established. The ignored measurement script is `tmp/ftc-calculation-benchmark.ts`.
