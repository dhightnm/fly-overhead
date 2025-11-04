const { Server } = require('socket.io');
const logger = require('../utils/logger');

/**
 * WebSocket Service for real-time aircraft updates
 * Broadcasts incremental updates to connected clients
 */
class WebSocketService {
  constructor() {
    this.io = null;
    this.connectedClients = 0;
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: true, // Allow all origins (CORS handled at Express level)
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'], // Fallback to polling if WebSocket fails
    });

    this.io.on('connection', (socket) => {
      this.connectedClients++;
      logger.info('WebSocket client connected', {
        socketId: socket.id,
        totalClients: this.connectedClients,
      });

      // Handle client joining a bounding box room
      socket.on('subscribe:bounds', (bounds) => {
        const roomName = this.getBoundsRoomName(bounds);
        socket.join(roomName);
        logger.debug('Client subscribed to bounds room', {
          socketId: socket.id,
          room: roomName,
          bounds,
        });
      });

      // Handle client leaving a bounding box room
      socket.on('unsubscribe:bounds', (bounds) => {
        const roomName = this.getBoundsRoomName(bounds);
        socket.leave(roomName);
        logger.debug('Client unsubscribed from bounds room', {
          socketId: socket.id,
          room: roomName,
        });
      });

      // Handle client disconnection
      socket.on('disconnect', (reason) => {
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
  getBoundsRoomName(bounds) {
    const rounded = {
      latmin: Math.floor(parseFloat(bounds.latmin) * 100) / 100,
      lonmin: Math.floor(parseFloat(bounds.lonmin) * 100) / 100,
      latmax: Math.ceil(parseFloat(bounds.latmax) * 100) / 100,
      lonmax: Math.ceil(parseFloat(bounds.lonmax) * 100) / 100,
    };
    return `bounds:${rounded.latmin}:${rounded.lonmin}:${rounded.latmax}:${rounded.lonmax}`;
  }

  /**
   * Broadcast aircraft updates to clients subscribed to a bounding box
   * Sends only incremental changes (added/updated/removed aircraft)
   */
  broadcastAircraftUpdate(bounds, updateType, data) {
    if (!this.io) {
      logger.warn('WebSocket server not initialized, cannot broadcast');
      return;
    }

    const roomName = this.getBoundsRoomName(bounds);
    const update = {
      type: updateType, // 'full', 'incremental', 'removed'
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
  broadcastFullAircraftList(bounds, aircraft) {
    this.broadcastAircraftUpdate(bounds, 'full', aircraft);
  }

  /**
   * Broadcast incremental update (only changed aircraft)
   */
  broadcastIncrementalUpdate(bounds, changes) {
    this.broadcastAircraftUpdate(bounds, 'incremental', changes);
  }

  /**
   * Broadcast removed aircraft (aircraft that left the area)
   */
  broadcastRemovedAircraft(bounds, removedIcao24s) {
    this.broadcastAircraftUpdate(bounds, 'removed', {
      removed: removedIcao24s,
    });
  }

  /**
   * Get number of connected clients
   */
  getConnectedClientsCount() {
    return this.connectedClients;
  }

  /**
   * Get Socket.IO instance (for advanced usage)
   */
  getIO() {
    return this.io;
  }
}

module.exports = new WebSocketService();



