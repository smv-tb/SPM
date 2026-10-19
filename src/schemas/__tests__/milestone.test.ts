import { describe, it, expect } from 'vitest';
import { milestoneSchema } from '@/schemas/milestone';

describe('Milestone Schema', () => {
  it('should validate a correct milestone', () => {
    const validData = {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      code: 'M1',
      title: 'Test Milestone',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      estBudget: 1000,
    };

    const result = milestoneSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('should fail with invalid data', () => {
    const invalidData = {
      projectId: 'not-a-uuid',
      code: '',
      title: 'Test Milestone',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    };

    const result = milestoneSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it('should apply default values', () => {
    const minimalData = {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      code: 'M1',
      title: 'Test Milestone',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    };

    const result = milestoneSchema.safeParse(minimalData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('NOT_STARTED');
      expect(result.data.priority).toBe('MED');
    }
  });
});