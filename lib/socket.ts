import type { Socket } from 'socket.io-client';

export interface ReviewerInfo {
  id: string;
  name: string;
}

export interface PresenceEntry {
  socketId: string;
  reviewer: ReviewerInfo;
  projectId: string | null;
}

export interface ReviewChangePayload {
  action: 'upsert' | 'delete';
  recordId: string;
  reviewer: ReviewerInfo;
  status?: 'good' | 'minor_issue' | 'major_issue';
  notes?: string;
  reviewed_at?: string;
}

export interface ClientToServerEvents {
  join: (reviewer: ReviewerInfo) => void;
  select_project: (projectId: string | null) => void;
  review_change: (payload: ReviewChangePayload) => void;
}

export interface ServerToClientEvents {
  presence_update: (presence: PresenceEntry[]) => void;
  review_change: (payload: ReviewChangePayload) => void;
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
