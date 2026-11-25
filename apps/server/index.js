import { createGameServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const game = createGameServer({ allowedOrigins });
game.listen(port).then((p) => {
  console.log(`[game-server] ws://0.0.0.0:${p}  (origins: ${allowedOrigins.join(', ') || '모두 허용(개발)'})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => game.close().then(() => process.exit(0)));
}
