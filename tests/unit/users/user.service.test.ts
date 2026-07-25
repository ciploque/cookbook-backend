import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from '../../../src/config/database';
import {
  provisionUser,
  getMe,
  updateMe,
  getUserById,
  getUserByUsername,
  provisionFromWebhook,
  deleteUserByAuthProviderId,
  ClerkWebhookUserData,
} from '../../../src/modules/users/user.service';

const mockUser = {
  id: 'user-uuid-1',
  authProviderId: 'user_abc',
  username: 'joao',
  displayName: 'João',
  bio: null,
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '5.0.0',
});

const p2002OnUsername = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '5.0.0',
  meta: { target: ['username'] },
});

const p2002OnAuthProviderId = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '5.0.0',
  meta: { target: ['authProviderId'] },
});

const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
  code: 'P2025',
  clientVersion: '5.0.0',
});

beforeEach(() => vi.clearAllMocks());

// ─── provisionUser ────────────────────────────────────────────────────────────

describe('provisionUser()', () => {
  it('creates a new user when the authProviderId does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser);

    const result = await provisionUser('user_abc', { username: 'joao', displayName: 'João' });

    expect(result.created).toBe(true);
    expect(result.user).toEqual(mockUser);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { authProviderId: 'user_abc', username: 'joao', displayName: 'João', avatarUrl: undefined },
    });
  });

  it('returns existing user without calling create (idempotent)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

    const result = await provisionUser('user_abc', { username: 'joao', displayName: 'João' });

    expect(result.created).toBe(false);
    expect(result.user).toEqual(mockUser);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('throws CONFLICT (409) when username is already taken', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockRejectedValue(p2002);

    await expect(provisionUser('user_new', { username: 'taken', displayName: 'New' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('re-throws unexpected errors from prisma.user.create', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const unexpectedError = new Error('DB connection lost');
    vi.mocked(prisma.user.create).mockRejectedValue(unexpectedError);

    await expect(provisionUser('user_new', { username: 'user', displayName: 'New' }))
      .rejects.toThrow('DB connection lost');
  });
});

// ─── getMe ───────────────────────────────────────────────────────────────────

describe('getMe()', () => {
  it('returns the user when found by authProviderId', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

    const result = await getMe('user_abc');

    expect(result).toEqual(mockUser);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { authProviderId: 'user_abc' } });
  });

  it('throws USER_NOT_FOUND (404) when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(getMe('user_missing')).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });
});

// ─── updateMe ────────────────────────────────────────────────────────────────

describe('updateMe()', () => {
  it('throws USER_NOT_FOUND when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(updateMe('user_missing', { displayName: 'New Name' }))
      .rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updates only the fields that were provided', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
    const updated = { ...mockUser, displayName: 'New Name' };
    vi.mocked(prisma.user.update).mockResolvedValue(updated);

    const result = await updateMe('user_abc', { displayName: 'New Name' });

    expect(result.displayName).toBe('New Name');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { authProviderId: 'user_abc' },
      data: { displayName: 'New Name' },
    });
  });

  it('does not include undefined fields in the update payload', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...mockUser, bio: 'New bio' });

    await updateMe('user_abc', { bio: 'New bio' });

    const callArgs = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty('displayName');
    expect(callArgs.data).not.toHaveProperty('avatarUrl');
    expect(callArgs.data).toHaveProperty('bio', 'New bio');
  });

  it('throws CONFLICT (409) when new username is already taken', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
    vi.mocked(prisma.user.update).mockRejectedValue(p2002);

    await expect(updateMe('user_abc', { username: 'taken' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });
});

// ─── getUserById ─────────────────────────────────────────────────────────────

describe('getUserById()', () => {
  it('returns the user without authProviderId (public field)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

    const result = await getUserById('user-uuid-1');

    expect(result).not.toHaveProperty('authProviderId');
    expect(result).toHaveProperty('id', 'user-uuid-1');
    expect(result).toHaveProperty('username', 'joao');
  });

  it('throws USER_NOT_FOUND (404) when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(getUserById('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });
});

// ─── getUserByUsername ───────────────────────────────────────────────────────

describe('getUserByUsername()', () => {
  it('returns the user without authProviderId (public field)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

    const result = await getUserByUsername('joao');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { username: 'joao' } });
    expect(result).not.toHaveProperty('authProviderId');
    expect(result).toHaveProperty('id', 'user-uuid-1');
    expect(result).toHaveProperty('username', 'joao');
  });

  it('throws USER_NOT_FOUND (404) when username does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(getUserByUsername('missing-username')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });
});

// ─── provisionFromWebhook ────────────────────────────────────────────────────

describe('provisionFromWebhook()', () => {
  const clerkUser: ClerkWebhookUserData = {
    id: 'user_clerk_1',
    username: 'JoaoLima',
    emailAddress: 'joao@example.com',
    firstName: 'João',
    lastName: 'Lima',
    imageUrl: 'https://img.clerk.com/joao.png',
  };

  it('returns the existing user without calling create (idempotent)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

    const result = await provisionFromWebhook(clerkUser);

    expect(result.created).toBe(false);
    expect(result.user).toEqual(mockUser);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a stub user from the Clerk username, lowercased and sanitized', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser);

    await provisionFromWebhook(clerkUser);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        authProviderId: 'user_clerk_1',
        username: 'joaolima',
        displayName: 'João Lima',
        avatarUrl: 'https://img.clerk.com/joao.png',
      },
    });
  });

  it('falls back to the email local-part when Clerk username is null', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser);

    await provisionFromWebhook({ ...clerkUser, username: null });

    const callArgs = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(callArgs.data.username).toBe('joao');
  });

  it('falls back to a generated user-id-based username when username and email are unusable', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser);

    await provisionFromWebhook({ ...clerkUser, username: null, emailAddress: null });

    const callArgs = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(callArgs.data.username).toBe(`user-${clerkUser.id.slice(-8)}`);
  });

  it('falls back to the username when first/last name are both missing', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser);

    await provisionFromWebhook({ ...clerkUser, firstName: null, lastName: null });

    const callArgs = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(callArgs.data.displayName).toBe('joaolima');
  });

  it('retries with a random suffix on a username collision, then succeeds', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockRejectedValueOnce(p2002OnUsername).mockResolvedValueOnce(mockUser);

    const result = await provisionFromWebhook(clerkUser);

    expect(result.created).toBe(true);
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
    const secondCallUsername = vi.mocked(prisma.user.create).mock.calls[1][0].data.username as string;
    expect(secondCallUsername).toMatch(/^joaolima-[a-f0-9]{4}$/);
  });

  it('returns the winning row when a create races on authProviderId (duplicate webhook delivery)', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null) // initial existence check
      .mockResolvedValueOnce(mockUser); // re-fetch after losing the race
    vi.mocked(prisma.user.create).mockRejectedValue(p2002OnAuthProviderId);

    const result = await provisionFromWebhook(clerkUser);

    expect(result.created).toBe(false);
    expect(result.user).toEqual(mockUser);
  });

  it('throws INTERNAL_ERROR after exhausting username collision retries', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockRejectedValue(p2002OnUsername);

    await expect(provisionFromWebhook(clerkUser)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(prisma.user.create).toHaveBeenCalledTimes(5);
  });

  it('re-throws unexpected errors from prisma.user.create', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const unexpectedError = new Error('DB connection lost');
    vi.mocked(prisma.user.create).mockRejectedValue(unexpectedError);

    await expect(provisionFromWebhook(clerkUser)).rejects.toThrow('DB connection lost');
  });
});

// ─── deleteUserByAuthProviderId ──────────────────────────────────────────────

describe('deleteUserByAuthProviderId()', () => {
  it('deletes the user by authProviderId', async () => {
    vi.mocked(prisma.user.delete).mockResolvedValue(mockUser);

    await deleteUserByAuthProviderId('user_abc');

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { authProviderId: 'user_abc' } });
  });

  it('is a no-op when the user does not exist (P2025)', async () => {
    vi.mocked(prisma.user.delete).mockRejectedValue(p2025);

    await expect(deleteUserByAuthProviderId('user_missing')).resolves.toBeUndefined();
  });

  it('re-throws unexpected errors', async () => {
    const unexpectedError = new Error('DB connection lost');
    vi.mocked(prisma.user.delete).mockRejectedValue(unexpectedError);

    await expect(deleteUserByAuthProviderId('user_abc')).rejects.toThrow('DB connection lost');
  });
});
