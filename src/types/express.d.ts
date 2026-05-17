import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      oauth?: {
        sub: string | null;
        email: string | null;
        scope: string[];
      };
    }
  }
}

export {};
