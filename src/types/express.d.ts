import 'express';
import type { WebhookEvent } from '@clerk/express/webhooks';

export interface AuthTokenPayload {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthTokenPayload;
    clerkEvent?: WebhookEvent;
  }
}
