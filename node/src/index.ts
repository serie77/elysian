import { config } from './config.js';
import { startExecutor } from './executor.js';
import { startIndexer } from './indexer.js';
import { startServer } from './server.js';

console.log(`elysian node  chain ${config.chainId}  pool ${config.pool}  swap ${config.swap}`);
startIndexer();
startExecutor();
await startServer();
