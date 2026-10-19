import { describe, it, expect } from 'vitest';
import { taskSchema } from '../task';

describe('Task Schema', () => {
  it('should validate a correct task', () => {
    const validData = {
      milestoneId: '550e8400-e29b-41d4-a716-446655440000',
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      code: 'T1',
      title: 'Test Task',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    };

    const result = taskSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('should fail with invalid data', () => {
    const invalidData = {
      projectId: 'not-a-uuid',
      code: '',
      title: 'Test Task',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    };

    const result = taskSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it('should apply default values', () => {
    const minimalData = {
      milestoneId: '550e8400-e29b-41d4-a716-446655440000',
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      code: 'T1',
      title: 'Test Task',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    };

    const result = taskSchema.safeParse(minimalData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.percentDone).toBe(0);
      expect(result.data.status).toBe('BACKLOG');
      expect(result.data.priority).toBe('MED');
      expect(result.data.orderIndex).toBe(0);
    }
  });
});