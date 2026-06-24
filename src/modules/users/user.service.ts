import { User, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { ProvisionUserInput, UpdateUserInput } from './user.schema';

export async function provisionUser(
  keycloakId: string,
  input: ProvisionUserInput,
): Promise<{ user: User; created: boolean }> {
  const existing = await prisma.user.findUnique({ where: { keycloakId } });
  if (existing) {
    return { user: existing, created: false };
  }

  try {
    const user = await prisma.user.create({
      data: { keycloakId, username: input.username, displayName: input.displayName, avatarUrl: input.avatarUrl },
    });
    return { user, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw ApiError.conflict('Username already taken');
    }
    throw e;
  }
}

export async function getMe(keycloakId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { keycloakId } });
  if (!user) throw ApiError.notFound('User');
  return user;
}

export async function updateMe(keycloakId: string, input: UpdateUserInput): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { keycloakId } });
  if (!existing) throw ApiError.notFound('User');

  try {
    return await prisma.user.update({
      where: { keycloakId },
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

export async function getUserById(id: string): Promise<Omit<User, 'keycloakId'>> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User');
  const { keycloakId: _, ...publicUser } = user;
  return publicUser;
}
