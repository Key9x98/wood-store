import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not forward a rejected promise from an async handler to the
 * error middleware — the rejection escapes as an unhandledRejection and the
 * request hangs. Wrapping the handler routes any rejection through `next`.
 */
export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
