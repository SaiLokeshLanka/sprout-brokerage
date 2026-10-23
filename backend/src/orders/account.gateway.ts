import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Private, per-user live updates on the Socket.IO namespace "/account".
 *
 * The client connects with `auth: { token: <access token> }`. A valid token joins
 * the socket to the room "user:<id>"; anything else is disconnected. Server → client:
 *   'order'  OrderView — whenever one of your orders is placed, executed, cancelled or expires
 */
@WebSocketGateway({ namespace: 'account', cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', credentials: true } })
export class AccountGateway implements OnGatewayConnection {
  @WebSocketServer() private server!: Namespace;
  private readonly logger = new Logger(AccountGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(String(client.handshake.auth?.token ?? ''));
      await client.join(`user:${payload.sub}`);
    } catch {
      client.emit('auth_error', { message: 'Invalid or expired access token' });
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    if (!this.server) return this.logger.warn('Account gateway not ready');
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
