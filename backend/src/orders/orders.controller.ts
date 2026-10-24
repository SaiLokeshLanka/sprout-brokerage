import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { checkIdempotencyKey } from '../common/idempotency';
import { ListOrdersQuery, PlaceOrderDto } from './orders.dto';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * POST /api/orders  { symbol, side, orderType, qty, limitPricePaise?, product? }
   * Optional header Idempotency-Key. Returns 201 with the order — its status is
   * EXECUTED, OPEN (waiting for its limit price) or REJECTED (with statusReason).
   * Invalid input (tick size, price band, index, lot size...) → 400 and nothing is recorded.
   */
  @Post('orders')
  place(@CurrentUser() user: AuthUser, @Body() dto: PlaceOrderDto, @Headers('idempotency-key') key?: string) {
    return this.orders.place(user.id, dto, checkIdempotencyKey(key));
  }

  /** GET /api/orders?status=OPEN&limit=50 — newest first */
  @Get('orders')
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQuery) {
    return this.orders.list(user.id, query);
  }

  /** GET /api/orders/:id */
  @Get('orders/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user.id, id);
  }

  /** DELETE /api/orders/:id — cancel an OPEN order (409 if it already executed) */
  @Delete('orders/:id')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(user.id, id);
  }
}
