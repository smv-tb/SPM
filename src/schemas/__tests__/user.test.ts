import { describe, it, expect } from 'vitest';
import { userSchema } from '../user';

describe('User Schema', () => {
  it('should validate a correct user', () => {
    const validData = {
      email: 'test@example.com',
      name: 'Test User',
    };

    const result = userSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('should fail with invalid data', () => {
    const invalidData = {
      email: 'invalid-email',
      name: 'Test User',
    };

    const result = userSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it('should apply default values', () => {
    const minimalData = {
      email: 'test@example.com',
      name: 'Test User',
    };

    const result = userSchema.safeParse(minimalData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('CONTRIBUTOR');
    }
  });
});