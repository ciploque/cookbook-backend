import { Request, Response } from 'express';
import * as userService from './user.service';
import { ProvisionUserInput, UpdateUserInput } from './user.schema';

export async function provisionMe(req: Request, res: Response): Promise<void> {
  const { user, created } = await userService.provisionUser(
    req.user!.sub,
    req.body as ProvisionUserInput,
  );
  res.status(created ? 201 : 200).json({ success: true, data: user });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await userService.getMe(req.user!.sub);
  res.json({ success: true, data: user });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = await userService.updateMe(req.user!.sub, req.body as UpdateUserInput);
  res.json({ success: true, data: user });
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await userService.getUserById(req.params.userId as string);
  res.json({ success: true, data: user });
}

export async function getUserByUsername(req: Request, res: Response): Promise<void> {
  const user = await userService.getUserByUsername(req.params.username as string);
  res.json({ success: true, data: user });
}
