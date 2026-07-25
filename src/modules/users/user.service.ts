import { randomBytes } from 'node:crypto';
import { User, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { ProvisionUserInput, UpdateUserInput } from './user.schema';

export async function provisionUser(
  authProviderId: string,
  input: ProvisionUserInput,
): Promise<{ user: User; created: boolean }> {
  const existing = await prisma.user.findUnique({ where: { authProviderId } });
  if (existing) {
    return { user: existing, created: false };
  }

  try {
    const user = await prisma.user.create({
      data: { authProviderId, username: input.username, displayName: input.displayName, avatarUrl: input.avatarUrl },
    });
    return { user, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw ApiError.conflict('Username already taken');
    }
    throw e;
  }
}

export async function getMe(authProviderId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { authProviderId } });
  if (!user) throw ApiError.notFound('User');
  return user;
}

export async function updateMe(authProviderId: string, input: UpdateUserInput): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { authProviderId } });
  if (!existing) throw ApiError.notFound('User');

  try {
    return await prisma.user.update({
      where: { authProviderId },
      data: {
        ...(input.username !== undefined && { username: input.username }),
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw ApiError.conflict('Username already taken');
    }
    throw e;
  }
}

export async function getUserById(id: string): Promise<Omit<User, 'authProviderId'>> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User');
  const { authProviderId: _, ...publicUser } = user;
  return publicUser;
}

export async function getUserByUsername(username: string): Promise<Omit<User, 'authProviderId'>> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw ApiError.notFound('User');
  const { authProviderId: _, ...publicUser } = user;
  return publicUser;
}

export interface ClerkWebhookUserData {
  id: string;
  username: string | null;
  emailAddress: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

function sanitizeUsername(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]/g, '');
}

function randomSuffix(length = 4): string {
  return randomBytes(4).toString('hex').slice(0, length);
}

function deriveUsername(data: ClerkWebhookUserData): string {
  const candidates = [data.username, data.emailAddress?.split('@')[0]].filter(
    (c): c is string => !!c,
  );
  for (const candidate of candidates) {
    const clean = sanitizeUsername(candidate).slice(0, 24);
    if (clean.length >= 3) return clean;
  }
  return `user-${data.id.slice(-8)}`;
}

// Stub-provisions a User row as soon as Clerk reports an account was created, using a
// generated fallback username (Clerk's own username field, if set, doesn't necessarily match
// this app's format). The frontend's POST /users/me remains the primary path for a
// user-chosen username; PUT /users/me lets them rename this stub afterwards.
export async function provisionFromWebhook(
  data: ClerkWebhookUserData,
): Promise<{ user: User; created: boolean }> {
  const existing = await prisma.user.findUnique({ where: { authProviderId: data.id } });
  if (existing) {
    return { user: existing, created: false };
  }

  const baseUsername = deriveUsername(data);
  const displayName = [data.firstName, data.lastName].filter(Boolean).join(' ') || baseUsername;

  for (let attempt = 0; attempt < 5; attempt++) {
    const username = attempt === 0 ? baseUsername : `${baseUsername}-${randomSuffix()}`;
    try {
      const user = await prisma.user.create({
        data: {
          authProviderId: data.id,
          username,
          displayName,
          avatarUrl: data.imageUrl ?? undefined,
        },
      });
      return { user, created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = (e.meta?.target as string[] | undefined) ?? [];
        if (target.includes('authProviderId')) {
          // Lost a create race (e.g. duplicate webhook delivery) — the row exists now.
          const race = await prisma.user.findUnique({ where: { authProviderId: data.id } });
          if (race) return { user: race, created: false };
        }
        continue; // username collision — retry with a random suffix
      }
      throw e;
    }
  }

  throw ApiError.internal('Failed to provision user from webhook: could not generate a unique username');
}

export async function deleteUserByAuthProviderId(authProviderId: string): Promise<void> {
  try {
    await prisma.user.delete({ where: { authProviderId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return; // already absent — redelivered webhook, or the user never completed provisioning
    }
    throw e;
  }
}
