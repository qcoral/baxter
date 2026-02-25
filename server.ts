import { createServer } from 'http';
import { Server } from 'socket.io';
import next from 'next';
import type { PresenceEntry, ClientToServerEvents, ServerToClientEvents, ReviewerInfo } from './lib/socket';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT ?? '3001', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

const presenceMap = new Map<string, PresenceEntry>();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    socket.on('join', (reviewer: ReviewerInfo) => {
      presenceMap.set(socket.id, { socketId: socket.id, reviewer, projectId: null });
      io.emit('presence_update', Array.from(presenceMap.values()));
    });

    socket.on('select_project', (projectId: string | null) => {
      const entry = presenceMap.get(socket.id);
      if (entry) {
        presenceMap.set(socket.id, { ...entry, projectId });
        io.emit('presence_update', Array.from(presenceMap.values()));
      }
    });

    socket.on('review_change', (payload) => {
      socket.broadcast.emit('review_change', payload);
    });

    socket.on('disconnect', () => {
      presenceMap.delete(socket.id);
      io.emit('presence_update', Array.from(presenceMap.values()));
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
