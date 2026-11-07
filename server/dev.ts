import { app } from "./app.js";

const port = Number(process.env.PORT ?? 8888);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Local API scaffold listening on http://127.0.0.1:${port}\n`);
});
