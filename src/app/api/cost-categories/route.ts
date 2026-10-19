import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { withErrorHandler, apiError, requireAuth } from '@/lib/api-errors';
import { hasPermission } from "@/lib/permissions";
import { costCategorySchema } from '@/schemas/cost-category';

export const GET = withErrorHandler(async () => {
  const session = await auth();
  if (!requireAuth(session)) {
    return apiError('Unauthorized', 401);
  }

  const categories = await prisma.costCategory.findMany({
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(categories);
});

export const POST = withErrorHandler(async (request: Request) => {
  const session = await auth();
  if (!requireAuth(session)) {
    return apiError('Unauthorized', 401);
  }
  if (!hasPermission(session, "categories:edit")) {
    return apiError('Forbidden', 403);
  }

  const body = await request.json();
  const validation = costCategorySchema.safeParse(body);
  if (!validation.success) {
    return apiError('Invalid request data', 400, { errors: validation.error.flatten() });
  }

  const { name } = validation.data;
  const category = await prisma.costCategory.create({
    data: { name },
  });
  return NextResponse.json(category);
});
