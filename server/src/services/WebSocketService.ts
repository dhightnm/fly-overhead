import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import logger from '../utils/logger';

interface Bounds {
  latmin: number | string;
  lonmin: number | string;
  latmax: number | string;
  lonmax: number | string;
}

interface AircraftUpdate {
  type: 'full' | 'incremental' | 'removed';
  timestamp: string;
  bounds: Bounds;
  data: any;
}

interface IncrementalChanges {
  added?: any[];
  updated?: any[];
  removed?: string[];
}

/**
 * WebSocket Service for real-time aircraft updates
 * Broadcasts incremental updates to connected clients
 */
class WebSocketService {
  private io: Server | null = null;

  private connectedClients: number = 0;

  /**
   * Initialize WebSocket server
   */
  initialize(server: HttpServer): void {
    this.io = new Server(server, {
      cors: {
        origin: true, // Allow all origins (CORS handled at Express level)
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'], // Fallback to polling if WebSocket fails
    });

    this.io.on('connection', (socket: Socket) => {
      this.connectedClients++;
      logger.info('WebSocket client connected', {
        socketId: socket.id,
        totalClients: this.connectedClients,
      });

      // Handle client joining a bounding box room
      socket.on('subscribe:bounds', (bounds: Bounds) => {
        const roomName = this.getBoundsRoomName(bounds);
        socket.join(roomName);
        logger.debug('Client subscribed to bounds room', {
          socketId: socket.id,
          room: roomName,
          bounds,
        });
      });

      // Handle client leaving a bounding box room
      socket.on('unsubscribe:bounds', (bounds: Bounds) => {
        const roomName = this.getBoundsRoomName(bounds);
        socket.leave(roomName);
        logger.debug('Client unsubscribed from bounds room', {
          socketId: socket.id,
          room: roomName,
        });
      });

      // Handle client disconnection
      socket.on('disconnect', (reason: string) => {
        this.connectedClients--;
        logger.info('WebSocket client disconnected', {
          socketId: socket.id,
          reason,
          totalClients: this.connectedClients,
        });
      });

      // Send initial connection confirmation
      socket.emit('connected', {
        message: 'Connected to real-time aircraft updates',
        serverTime: new Date().toISOString(),
      });
    });

    logger.info('WebSocket server initialized');
  }

  /**
   * Generate room name from bounding box coordinates
   * Rounds coordinates to reduce room fragmentation
   */
  getBoundsRoomName(bounds: Bounds): string {
    const rounded = {
      latmin: Math.floor(parseFloat(String(bounds.latmin)) * 100) / 100,
      lonmin: Math.floor(parseFloat(String(bounds.lonmin)) * 100) / 100,
      latmax: Math.ceil(parseFloat(String(bounds.latmax)) * 100) / 100,
      lonmax: Math.ceil(parseFloat(String(bounds.lonmax)) * 100) / 100,
    };
    return `bounds:${rounded.latmin}:${rounded.lonmin}:${rounded.latmax}:${rounded.lonmax}`;
  }

  /**
   * Broadcast aircraft updates to clients subscribed to a bounding box
   * Sends only incremental changes (added/updated/removed aircraft)
   */
  broadcastAircraftUpdate(bounds: Bounds, updateType: 'full' | 'incremental' | 'removed', data: any): void {
    if (!this.io) {
      logger.warn('WebSocket server not initialized, cannot broadcast');
      return;
    }

    const roomName = this.getBoundsRoomName(bounds);
    const update: AircraftUpdate = {
      type: updateType,
      timestamp: new Date().toISOString(),
      bounds,
      data,
    };

    // Send to all clients in this bounding box room
    this.io.to(roomName).emit('aircraft:update', update);

    logger.debug('Broadcasted aircraft update', {
      room: roomName,
      type: updateType,
      aircraftCount: Array.isArray(data) ? data.length : (data.added?.length || 0) + (data.updated?.length || 0) + (data.removed?.length || 0),
      clientsInRoom: this.io.sockets.adapter.rooms.get(roomName)?.size || 0,
    });
  }

  /**
   * Broadcast full aircraft list (for initial connection or full refresh)
   */
  broadcastFullAircraftList(bounds: Bounds, aircraft: any[]): void {
    this.broadcastAircraftUpdate(bounds, 'full', aircraft);
  }

  /**
   * Broadcast incremental update (only changed aircraft)
   */
  broadcastIncrementalUpdate(bounds: Bounds, changes: IncrementalChanges): void {
    this.broadcastAircraftUpdate(bounds, 'incremental', changes);
  }

  /**
   * Broadcast removed aircraft (aircraft that left the area)
   */
  broadcastRemovedAircraft(bounds: Bounds, removedIcao24s: string[]): void {
    this.broadcastAircraftUpdate(bounds, 'removed', {
      removed: removedIcao24s,
    });
  }

  /**
   * Get number of connected clients
   */
  getConnectedClientsCount(): number {
    return this.connectedClients;
  }

  /**
   * Get Socket.IO instance (for advanced usage)
   */
  getIO(): Server | null {
    return this.io;
  }
}

// Export singleton instance
const webSocketService = new WebSocketService();
export default webSocketService;
