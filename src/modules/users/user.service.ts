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
