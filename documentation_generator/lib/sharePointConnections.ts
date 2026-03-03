import "server-only";

export type SharePointConnectionStatus = "active" | "expired" | "revoked";

export type SharePointConnection = {
  id: string;
  label: string;
  tenantId: string;
  accountEmail: string;
  createdAt: string;
  lastUsedAt?: string;
  status: SharePointConnectionStatus;
};

export interface ConnectionStore {
  list(userId: string): SharePointConnection[];
  create(userId: string, connection: SharePointConnection): SharePointConnection;
  get(userId: string, connectionId: string): SharePointConnection | null;
  delete(userId: string, connectionId: string): boolean;
  touchLastUsed(userId: string, connectionId: string): SharePointConnection | null;
}

export class InMemoryConnectionStore implements ConnectionStore {
  private readonly byUser = new Map<string, Map<string, SharePointConnection>>();

  list(userId: string): SharePointConnection[] {
    const userConnections = this.byUser.get(userId);
    if (!userConnections) return [];

    return Array.from(userConnections.values())
      .map(cloneConnection)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(userId: string, connection: SharePointConnection): SharePointConnection {
    const userConnections = this.getOrCreateUserMap(userId);
    const next = cloneConnection(connection);
    userConnections.set(next.id, next);
    return cloneConnection(next);
  }

  get(userId: string, connectionId: string): SharePointConnection | null {
    const userConnections = this.byUser.get(userId);
    if (!userConnections) return null;

    const found = userConnections.get(connectionId);
    return found ? cloneConnection(found) : null;
  }

  delete(userId: string, connectionId: string): boolean {
    const userConnections = this.byUser.get(userId);
    if (!userConnections) return false;

    const removed = userConnections.delete(connectionId);
    if (userConnections.size === 0) {
      this.byUser.delete(userId);
    }
    return removed;
  }

  touchLastUsed(userId: string, connectionId: string): SharePointConnection | null {
    const userConnections = this.byUser.get(userId);
    if (!userConnections) return null;

    const found = userConnections.get(connectionId);
    if (!found) return null;

    found.lastUsedAt = new Date().toISOString();
    return cloneConnection(found);
  }

  private getOrCreateUserMap(userId: string): Map<string, SharePointConnection> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;

    const created = new Map<string, SharePointConnection>();
    this.byUser.set(userId, created);
    return created;
  }
}

function cloneConnection(connection: SharePointConnection): SharePointConnection {
  return { ...connection };
}

export const inMemoryConnectionStore = new InMemoryConnectionStore();
export const sharePointConnectionStore: ConnectionStore = inMemoryConnectionStore;
