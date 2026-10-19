import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { withErrorHandler, apiError, requireAuth } from '@/lib/api-errors';
import { hasPermission } from "@/lib/permissions";
import { costCategoryUpdateSchema } from '@/schemas/cost-category';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (_request: Request, context: RouteContext) => {
  const session = await auth();
  if (!requireAuth(session)) {
    return apiError('Unauthorized', 401);
  }

  const { id } = await context.params;
  const category = await prisma.costCategory.findUnique({
    where: { id },
  });
  if (!category) {
    return apiError('Cost category not found', 404);
  }
  return NextResponse.json(category);
});

export const PUT = withErrorHandler(async (request: Request, context: RouteContext) => {
  const session = await auth();
  if (!requireAuth(session)) {
    return apiError('Unauthorized', 401);
  }
  if (!hasPermission(session, "categories:edit")) {
    return apiError('Forbidden', 403);
  }

  const { id } = await context.params;
  const body = await request.json();
  const validation = costCategoryUpdateSchema.safeParse(body);
  if (!validation.success) {
    return apiError('Invalid request data', 400, { errors: validation.error.flatten() });
  }

  const category = await prisma.costCategory.update({
    where: { id },
    data: validation.data,
  });
  return NextResponse.json(category);
});

export const DELETE = withErrorHandler(async (_request: Request, context: RouteContext) => {
  const session = await auth();
  if (!requireAuth(session)) {
    return apiError('Unauthorized', 401);
  }
  if (!hasPermission(session, "categories:edit")) {
    return apiError('Forbidden', 403);
  }

  const { id } = await context.params;
  await prisma.costCategory.delete({
    where: { id },
  });
  return NextResponse.json({ message: 'Cost category deleted' });
});
