import { Request, Response } from 'express';
import * as userService from '../users/user.service';

export async function handleClerkWebhook(req: Request, res: Response): Promise<void> {
  const event = req.clerkEvent!;

  switch (event.type) {
    case 'user.created': {
      const { id, username, first_name, last_name, image_url, email_addresses, primary_email_address_id } =
        event.data;
      const primaryEmail =
        email_addresses.find((e) => e.id === primary_email_address_id)?.email_address ??
        email_addresses[0]?.email_address ??
        null;
      await userService.provisionFromWebhook({
        id,
        username,
        emailAddress: primaryEmail,
        firstName: first_name,
        lastName: last_name,
        imageUrl: image_url ?? null,
      });
      break;
    }
    case 'user.deleted':
      if (event.data.id) {
        await userService.deleteUserByAuthProviderId(event.data.id);
      }
      break;
    case 'user.updated':
      // No-op: username/displayName/bio are app-owned via PUT /users/me and intentionally
      // may diverge from Clerk's profile fields. Only avatarUrl could plausibly be synced
      // here in the future.
      req.log.info({ clerkUserId: event.data.id }, 'Received Clerk user.updated webhook');
      break;
    default:
      req.log.debug({ eventType: event.type }, 'Ignoring unhandled Clerk webhook event type');
  }

  res.status(200).json({ success: true });
}
