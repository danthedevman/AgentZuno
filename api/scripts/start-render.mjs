// Render references host:port values without supporting URL interpolation.
process.env.DATABASE_SETUP_MODE = 'environment';
const mode = process.argv[2];
if (!['api', 'worker'].includes(mode)) throw new Error('Expected api or worker.');
for (const service of ['OLLAMA', 'QDRANT']) {
  const address = process.env[`${service}_HOSTPORT`];
  if (!address || !/^[a-zA-Z0-9.-]+:\d+$/.test(address))
    throw new Error(`Missing or invalid ${service}_HOSTPORT.`);
  process.env[`${service}_URL`] = `http://${address}`;
}
if (
  !(process.env.DATABASE_PROVIDER === 'postgres'
    ? process.env.POSTGRES_URL
    : process.env.MONGODB_URI) ||
  !process.env.CREDENTIAL_ENCRYPTION_KEY
)
  throw new Error('The application database and credential encryption must be configured.');
if (!process.env.APP_ORIGIN?.startsWith('https://'))
  throw new Error('APP_ORIGIN must be the public HTTPS web origin.');
await import(mode === 'api' ? '../src/index.js' : '../src/worker.js');
