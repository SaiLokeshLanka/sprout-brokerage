import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Prisma error codes meaning "couldn't reach / talk to the database server". */
const CONNECTION_ERROR_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

/**
 * Turns "database is down" into 503 Service Unavailable instead of a generic 500,
 * so clients can tell an outage (retry later) apart from a bug.
 * Every other Prisma error is handed to Nest's default handling (a normal 500).
 */
@Catch(Prisma.PrismaClientInitializationError, Prisma.PrismaClientKnownRequestError)
export class DatabaseUnavailableFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(DatabaseUnavailableFilter.name);

  catch(err: Prisma.PrismaClientInitializationError | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const isConnectionError =
      err instanceof Prisma.PrismaClientInitializationError || CONNECTION_ERROR_CODES.has(err.code);
    if (!isConnectionError) return super.catch(err, host);

    this.logger.error(`Database unavailable: ${err.message.split('\n').filter(Boolean).pop()}`);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(503)
      .json({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
  }
}
