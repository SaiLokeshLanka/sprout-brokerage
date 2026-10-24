import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { CreateGttDto, ListGttQuery } from './gtt.dto';
import { GttService } from './gtt.service';

@Controller('gtt')
export class GttController {
  constructor(private readonly gtt: GttService) {}

  /** POST /api/gtt { symbol, side, kind: SINGLE|OCO, qty, triggerPricePaise, limitPricePaise, stopTriggerPricePaise?, stopLimitPricePaise? } */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGttDto) {
    return this.gtt.create(user.id, dto);
  }

  /** GET /api/gtt?status=ACTIVE — newest first */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListGttQuery) {
    return this.gtt.list(user.id, query);
  }

  /** DELETE /api/gtt/:id — cancel an ACTIVE GTT (409 otherwise) */
  @Delete(':id')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gtt.cancel(user.id, id);
  }
}
