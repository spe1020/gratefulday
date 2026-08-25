/**
 * Primal Cache Service for Nostr profile search
 * Uses Primal's WebSocket cache API for fast, reliable profile searches
 */

import { verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

type PrimalProfile = {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
};

type PrimalSearchResult = {
  profiles: PrimalProfile[];
};

export class PrimalCacheService {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: PrimalSearchResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    profiles: PrimalProfile[];
  }> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private currentEndpoint = 0;
  private endpoints = [
    'wss://cache2.primal.net/v1',
    'wss://cache1.primal.net/v1',
  ];

  constructor() {
    this.connect();
  }

  private connect() {
    const endpoint = this.endpoints[this.currentEndpoint];
    if (import.meta.env.DEV) {
      console.log(`[PrimalCache] Connecting to ${endpoint}`);
    }

    try {
      this.ws = new WebSocket(endpoint);

      this.ws.onopen = () => {
        if (import.meta.env.DEV) {
          console.log('[PrimalCache] Connected');
        }
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[PrimalCache] Error parsing message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[PrimalCache] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        if (import.meta.env.DEV) {
          console.log('[PrimalCache] Connection closed');
        }
        this.handleDisconnect();
      };
    } catch (error) {
      console.error('[PrimalCache] Connection error:', error);
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    // Clear pending requests with error
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('WebSocket disconnected'));
    });
    this.pendingRequests.clear();

    // Try reconnecting
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      if (import.meta.env.DEV) {
        console.log(`[PrimalCache] Reconnecting... (attempt ${this.reconnectAttempts})`);
      }

      // Try next endpoint on reconnect
      this.currentEndpoint = (this.currentEndpoint + 1) % this.endpoints.length;

      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    } else {
      console.error('[PrimalCache] Max reconnect attempts reached');
    }
  }

  private handleMessage(data: unknown) {
    if (!Array.isArray(data) || data.length < 2) return;

    const [messageType, requestId, ...rest] = data;

    if (messageType === 'EVENT' && requestId && rest.length > 0) {
      const event = rest[0] as Event;
      const pending = this.pendingRequests.get(requestId);

      // Primal is an untrusted third party — only accept kind-0 events whose
      // signatures actually verify.
      if (pending && event?.kind === 0 && this.isValidEvent(event)) {
        try {
          const metadata = JSON.parse(event.content);
          pending.profiles.push({
            pubkey: event.pubkey,
            name: metadata.name,
            display_name: metadata.display_name,
            picture: metadata.picture,
            nip05: metadata.nip05,
            about: metadata.about,
          });
        } catch (error) {
          console.error('[PrimalCache] Error parsing profile metadata:', error);
        }
      }
    } else if (messageType === 'EOSE' && requestId) {
      // End of stream - resolve the request
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve({ profiles: pending.profiles });
        this.pendingRequests.delete(requestId);
      }
    } else if (messageType === 'NOTICE') {
      console.warn('[PrimalCache] Notice:', rest);
    }
  }

  private isValidEvent(event: Event): boolean {
    try {
      return verifyEvent(event);
    } catch {
      return false;
    }
  }

  private generateRequestId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Lazily (re)connect when the socket is down — including after the
   * background reconnect loop has given up — so a transient outage doesn't
   * disable search for the rest of the session.
   */
  private async ensureConnected(timeoutMs: number): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.reconnectAttempts = 0;
      this.currentEndpoint = (this.currentEndpoint + 1) % this.endpoints.length;
      this.connect();
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('WebSocket not connected');
  }

  public async searchProfiles(query: string, limit: number = 10, timeoutMs: number = 5000): Promise<PrimalProfile[]> {
    if (!query || query.length < 2) {
      return [];
    }

    await this.ensureConnected(Math.min(timeoutMs, 3000));

    const requestId = this.generateRequestId();

    const request = [
      'REQ',
      requestId,
      {
        cache: [
          'user_search',
          {
            query,
            limit,
          },
        ],
      },
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Search request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (result) => resolve(result.profiles),
        reject,
        timeout,
        profiles: [],
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton instance
let primalCache: PrimalCacheService | null = null;

export const getPrimalCache = (): PrimalCacheService => {
  if (!primalCache) {
    primalCache = new PrimalCacheService();
  }
  return primalCache;
};
