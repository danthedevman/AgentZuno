import { createApiServer } from './app.js';

const port = Number(process.env.PORT || 3001);
const server = createApiServer();
server.listen(port, '0.0.0.0', () =>
  console.log(`AgentZuno API listening on http://localhost:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
