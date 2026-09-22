// Vercel serverless entry: imports the Express app WITHOUT starting a listener
// (server.js only listens when run directly, not on Vercel).
import app from '../src/server.js';

export default app;
