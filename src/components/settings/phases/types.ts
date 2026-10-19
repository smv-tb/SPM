export interface Phase {
  id: string;
  name: string;
  color?: string | null;
  orderIndex: number;
  startDate?: Date | null;
  endDate?: Date | null;
}
